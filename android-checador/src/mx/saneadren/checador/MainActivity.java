package mx.saneadren.checador;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.Context;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.print.PrintAttributes;
import android.print.PrintManager;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

/**
 * Reloj checador de Saneadren para la tableta. Muestra la pantalla /kiosco del sistema y hace lo que un navegador no:
 *  - la pantalla NUNCA se apaga sola mientras la app está abierta;
 *  - si alguien apaga y prende la tableta, el checador sale ENCIMA del bloqueo (no pide el PIN de la tableta para checar);
 *  - pantalla completa, horizontal, sin barra de direcciones; solo abre páginas del sistema;
 *  - si la página se cae o no carga, se reintenta sola;
 *  - si alguien deja abierta otra página del sistema, a los 5 minutos sin tocar regresa al checador.
 */
public class MainActivity extends Activity {
    private static final int PERMISO_CAMARA = 7;
    private static final long REGRESO_MS = 5 * 60 * 1000;
    private final Handler reloj = new Handler(Looper.getMainLooper());
    private WebView web;
    private String base, anfitrion;
    private PermissionRequest pendiente;
    private boolean avisoRegistro;
    private long ultimoToque = System.currentTimeMillis();

    @Override
    protected void onCreate(Bundle guardado) {
        super.onCreate(guardado);
        base = getString(R.string.direccion).replaceAll("/+$", "");
        anfitrion = Uri.parse(base).getHost();
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        if (Build.VERSION.SDK_INT >= 27) { setShowWhenLocked(true); setTurnScreenOn(true); }
        else getWindow().addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON);
        crearWeb();
        if (checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) requestPermissions(new String[] { Manifest.permission.CAMERA }, PERMISO_CAMARA);
        reloj.postDelayed(vigilante, 30000);
    }

    private String kiosco() { return base + "/kiosco"; }
    private boolean esDelSistema(Uri u) { return u != null && anfitrion != null && anfitrion.equalsIgnoreCase(u.getHost()) && base.startsWith(u.getScheme() + "://"); }
    private boolean enKiosco() { String u = web == null ? null : web.getUrl(); return u != null && u.startsWith(kiosco()); }

    private void crearWeb() {
        web = new WebView(this);
        setContentView(web);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setSupportMultipleWindows(false);
        s.setTextZoom(100);
        s.setUserAgentString(s.getUserAgentString() + " SaneadrenChecador/1");
        CookieManager.getInstance().setAcceptCookie(true);
        web.addJavascriptInterface(new Puente(), "SaneadrenApp");
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) { return !esDelSistema(r.getUrl()); } // nada fuera del sistema
            @Override public void onReceivedError(WebView v, WebResourceRequest r, WebResourceError e) {
                if (!r.isForMainFrame()) return;
                // Sin red y sin copia guardada: una pantalla de espera que se reintenta sola (nunca en blanco).
                v.loadDataWithBaseURL(null, "<html><body style='font-family:sans-serif;text-align:center;padding-top:20vh;background:#f4f5f7;color:#1a1d23'><h1>Reloj checador</h1><p style='font-size:1.3rem;color:#4b5563'>Conectando con el servidor… Se reintenta solo.</p></body></html>", "text/html", "utf-8", null);
                reloj.postDelayed(() -> { if (web == v) v.loadUrl(kiosco()); }, 5000);
            }
            @Override public boolean onRenderProcessGone(WebView v, RenderProcessGoneDetail d) {
                // El motor de la página se cayó (poca memoria): se arma de nuevo en vez de dejar la app muerta.
                if (web == v) { v.destroy(); crearWeb(); }
                return true;
            }
            @Override public void onPageFinished(WebView v, String url) {
                // Imprimir (orden de servicio y factura): la página llama window.print(); aquí se abre la impresión de Android.
                v.evaluateJavascript("window.print = function () { SaneadrenApp.imprimir(); };", null);
                if (!avisoRegistro && url != null && url.startsWith(kiosco()))
                    v.evaluateJavascript("(function(){try{return !!JSON.parse(localStorage.getItem('saneadren_kiosco')||'null').token}catch(e){return false}})()", r -> { if ("false".equals(r)) pedirRegistro(); });
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public void onPermissionRequest(PermissionRequest p) {
                runOnUiThread(() -> {
                    boolean camara = false;
                    for (String x : p.getResources()) if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(x)) camara = true;
                    if (!camara || !esDelSistema(p.getOrigin())) { p.deny(); return; }
                    if (checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) p.grant(new String[] { PermissionRequest.RESOURCE_VIDEO_CAPTURE });
                    else { pendiente = p; requestPermissions(new String[] { Manifest.permission.CAMERA }, PERMISO_CAMARA); }
                });
            }
        });
        web.loadUrl(kiosco());
    }

    // La primera vez la tableta no está registrada como kiosco dentro de esta app: se abre el sistema para registrarla.
    private void pedirRegistro() {
        if (avisoRegistro || isFinishing()) return;
        avisoRegistro = true;
        new AlertDialog.Builder(this)
            .setTitle("Falta registrar esta tableta")
            .setMessage("Esta app todavía no está registrada como reloj checador.\n\nEntra al sistema con tu usuario, ve a RH → «Kioscos del checador», regístrala y toca «Abrir el kiosco».")
            .setPositiveButton("Abrir el sistema", (d, w) -> web.loadUrl(base + "/"))
            .setNegativeButton("Ahora no", null)
            .show();
    }

    // Cada 30 s: si quedó abierta otra página del sistema y nadie toca la pantalla en 5 minutos, regresa al checador.
    private final Runnable vigilante = new Runnable() {
        @Override public void run() {
            try {
                String u = web == null ? null : web.getUrl();
                if (u != null && !enKiosco() && System.currentTimeMillis() - ultimoToque > REGRESO_MS) web.loadUrl(kiosco());
            } finally { reloj.postDelayed(this, 30000); }
        }
    };

    private class Puente {
        @JavascriptInterface public void imprimir() {
            runOnUiThread(() -> {
                try {
                    PrintManager pm = (PrintManager) getSystemService(Context.PRINT_SERVICE);
                    pm.print("Saneadren", web.createPrintDocumentAdapter("Saneadren"), new PrintAttributes.Builder().build());
                } catch (Exception e) { /* sin servicio de impresión */ }
            });
        }
    }

    @Override public boolean dispatchTouchEvent(MotionEvent e) { ultimoToque = System.currentTimeMillis(); return super.dispatchTouchEvent(e); }

    @Override public void onRequestPermissionsResult(int codigo, String[] permisos, int[] resultados) {
        if (codigo != PERMISO_CAMARA) return;
        boolean ok = resultados.length > 0 && resultados[0] == PackageManager.PERMISSION_GRANTED;
        if (pendiente != null) { if (ok) pendiente.grant(new String[] { PermissionRequest.RESOURCE_VIDEO_CAPTURE }); else pendiente.deny(); pendiente = null; }
        else if (ok && web != null && enKiosco()) web.reload(); // el permiso llegó después de abrir: que la página vuelva a pedir la cámara
    }

    // «Atrás» nunca saca del checador; en otra página del sistema regresa una página.
    @Override public void onBackPressed() { if (web != null && !enKiosco() && web.canGoBack()) web.goBack(); }

    @Override public void onWindowFocusChanged(boolean conFoco) {
        super.onWindowFocusChanged(conFoco);
        if (!conFoco) return;
        if (Build.VERSION.SDK_INT >= 30) {
            WindowInsetsController c = getWindow().getInsetsController();
            if (c != null) { c.hide(WindowInsets.Type.systemBars()); c.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE); }
        } else {
            getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
        }
    }

    @Override protected void onResume() { super.onResume(); if (web != null) web.onResume(); }
    @Override protected void onPause() { if (web != null) web.onPause(); super.onPause(); }
    @Override protected void onDestroy() { reloj.removeCallbacksAndMessages(null); if (web != null) web.destroy(); super.onDestroy(); }
}
