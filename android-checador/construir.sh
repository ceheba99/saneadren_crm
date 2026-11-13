#!/bin/bash
# Arma la app del reloj checador (APK) con las herramientas que instala Android Studio; no usa Gradle.
# Uso:  bash android-checador/construir.sh
#   CHECADOR_URL=http://10.0.2.2:3000 bash android-checador/construir.sh   (app de PRUEBAS contra esta computadora)
# La firma vive FUERA del repositorio, en ~/.saneadren-checador (se crea la primera vez). HAY QUE RESPALDAR esa carpeta:
# sin ella no se puede publicar una versión nueva encima de la instalada (habría que desinstalar y registrar de nuevo).
set -euo pipefail
cd "$(dirname "$0")"
SDK="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
export JAVA_HOME="${JAVA_HOME:-/Applications/Android Studio.app/Contents/jbr/Contents/Home}"
export PATH="$JAVA_HOME/bin:$PATH"
BT="$(ls -d "$SDK"/build-tools/* | sort -V | tail -1)"
PLAT="$(ls -d "$SDK"/platforms/android-* | sort -V | tail -1)/android.jar"
[ -x "$BT/aapt2" ] && [ -f "$PLAT" ] || { echo "No encuentro las herramientas de Android en $SDK (abre Android Studio una vez para que las instale)"; exit 1; }
VERSION="${CHECADOR_VERSION:-1.0}"; CODIGO="$(date +%y%m%d%H)"
T=salida/tmp; rm -rf "$T"; mkdir -p "$T/res" "$T/gen" "$T/clases" "$T/dex"
cp -R res/. "$T/res/"
NOMBRE=checador-saneadren
if [ -n "${CHECADOR_URL:-}" ]; then
  NOMBRE=checador-saneadren-PRUEBAS
  sed -i '' "s|<string name=\"direccion\">.*</string>|<string name=\"direccion\">$CHECADOR_URL</string>|; s|<string name=\"nombre\">.*</string>|<string name=\"nombre\">Checador PRUEBAS</string>|" "$T/res/values/valores.xml"
  case "$CHECADOR_URL" in http://*) sed -i '' 's|<bool name="sin_candado">false</bool>|<bool name="sin_candado">true</bool>|' "$T/res/values/valores.xml";; esac
fi
"$BT/aapt2" compile --dir "$T/res" -o "$T/res.zip"
"$BT/aapt2" link -o "$T/base.apk" -I "$PLAT" --manifest AndroidManifest.xml --java "$T/gen" --min-sdk-version 26 --target-sdk-version 35 --version-code "$CODIGO" --version-name "$VERSION" "$T/res.zip"
javac --release 11 -Xlint:-options -nowarn -cp "$PLAT" -d "$T/clases" $(find src "$T/gen" -name '*.java')
"$BT/d8" --release --min-api 26 --lib "$PLAT" --output "$T/dex" $(find "$T/clases" -name '*.class')
cp "$T/base.apk" "$T/sin-firma.apk"; (cd "$T/dex" && zip -q ../sin-firma.apk classes.dex)
"$BT/zipalign" -f -p 4 "$T/sin-firma.apk" "$T/alineada.apk"
FIRMA="$HOME/.saneadren-checador"
if [ ! -f "$FIRMA/firma.keystore" ]; then
  mkdir -p "$FIRMA"; chmod 700 "$FIRMA"
  openssl rand -hex 24 | tr -d '\n' > "$FIRMA/clave.txt"; chmod 600 "$FIRMA/clave.txt"
  keytool -genkeypair -keystore "$FIRMA/firma.keystore" -storepass:file "$FIRMA/clave.txt" -alias checador -keyalg RSA -keysize 2048 -validity 10950 -dname "CN=Checador Saneadren, O=Saneadren, C=MX" >/dev/null 2>&1
  echo "Se creó la firma de la app en $FIRMA — RESPALDA esa carpeta."
fi
"$BT/apksigner" sign --ks "$FIRMA/firma.keystore" --ks-key-alias checador --ks-pass "file:$FIRMA/clave.txt" --out "salida/$NOMBRE.apk" "$T/alineada.apk"
"$BT/apksigner" verify "salida/$NOMBRE.apk"
rm -rf "$T" "salida/$NOMBRE.apk.idsig"
echo "Lista: $(pwd)/salida/$NOMBRE.apk (versión $VERSION, código $CODIGO)"
