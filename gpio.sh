source ./.env
# .env has the following:
# SYSFS=/sys/class/gpio		sysfs path to use
# RESET=123			pin id used for reset
# GPIO_0=124			pin id used to start flash mode
# SERIALPORT=/dev/ttyUSB0

esp_reset() {
  esp_iostart
  echo 1 > $SYSFS/gpio$GPIO_0/value
  echo 1 > $SYSFS/gpio$RESET/value

  echo 0 > $SYSFS/gpio$RESET/value
  sleep 1
  echo 1 > $SYSFS/gpio$RESET/value
  esp_iostop
}

esp_reset_flash() {
  esp_iostart
  echo 1 > $SYSFS/gpio$GPIO_0/value
  echo 1 > $SYSFS/gpio$RESET/value

  echo 0 > $SYSFS/gpio$GPIO_0/value
  sleep 1
  echo 0 > $SYSFS/gpio$RESET/value
  sleep 1
  echo 1 > $SYSFS/gpio$RESET/value
  esp_iostop
}

esp_iostart() {
  echo $RESET > $SYSFS/export
  echo $GPIO_0 > $SYSFS/export
  echo out > $SYSFS/gpio$RESET/direction
  echo out > $SYSFS/gpio$GPIO_0/direction
  sleep 1
}

esp_iostop() {
  sleep 1
  echo in > $SYSFS/gpio$RESET/direction
  echo in > $SYSFS/gpio$GPIO_0/direction
  echo $RESET > $SYSFS/unexport
  echo $GPIO_0 > $SYSFS/unexport
}

esp_connect() {
  nmcli dev wifi connect Homebots_AP
}

esp_run() {
  # esp8266 has an internal dhcp on range 192.168.4.*
  cat $1 | nc 192.168.4.1 3000
}

esp_hex2bin() {
  cat $1 | node -e 'process.stdin.on("data", b=>process.stdout.write(Buffer.from(b,"hex")))'
}

esp_flash() {
    esptool.py --port $SERIAL_PORT --baud 115200  write_flash --compress --flash_freq 80m -fm qio -fs 1MB 0x00000 firmware/0x00000.bin 0x10000 firmware/0x10000.bin
}
