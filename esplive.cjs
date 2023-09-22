const http = require('http');
const fs = require("fs");
const { writeFile } = require('fs/promises');
const sh = require("child_process").spawnSync;

const env = require('./esplive.conf.js')
const {
  RESET,
  GPIO_0,
  SYSFS,
  ESP_URL,
  ESP_SSID,
  SERIAL_PORT,
} = env;

async function echo(v, f) {
  try {
    // console.log(`${v} > ${f}`);
    await writeFile(f, String(v) + '\n');
  } catch (error) {
    console.log(`Failed to write ${f}:`, error);
  }
}

function sleep(time = 1000) {
  return new Promise((r) => setTimeout(r, time));
}

async function esp_reset() {
  await esp_iostart();
  await echo(1, `${SYSFS}/gpio${GPIO_0}/value`);
  await echo(1, `${SYSFS}/gpio${RESET}/value`);

  await echo(0, `${SYSFS}/gpio${RESET}/value`);
  await sleep();
  await echo(1, `${SYSFS}/gpio${RESET}/value`);
  await esp_iostop();
}

async function esp_reset_flash() {
  await esp_iostart();
  await echo(1, `${SYSFS}/gpio${GPIO_0}/value`);
  await echo(1, `${SYSFS}/gpio${RESET}/value`);

  await echo(0, `${SYSFS}/gpio${GPIO_0}/value`);
  await sleep();
  await echo(0, `${SYSFS}/gpio${RESET}/value`);
  await sleep();
  await echo(1, `${SYSFS}/gpio${RESET}/value`);
  await esp_iostop();
}

async function esp_iostart() {
  await echo(RESET, `${SYSFS}/export`);
  await echo(GPIO_0, `${SYSFS}/export`);
  await echo("out", `${SYSFS}/gpio${RESET}/direction`);
  await echo("out", `${SYSFS}/gpio${GPIO_0}/direction`);
  await sleep();
}

async function esp_iostop() {
  await sleep();
  await echo("in", `${SYSFS}/gpio${RESET}/direction`);
  await echo("in", `${SYSFS}/gpio${GPIO_0}/direction`);
  await echo(RESET, `${SYSFS}/unexport`);
  await echo(GPIO_0, `${SYSFS}/unexport`);
}

function esp_connect() {
  sh("nmcli", ["c", "down", ESP_SSID]);
  sh("nmcli", ["c", "up", ESP_SSID]);
  // sh("nmcli", ["dev", "wifi", "connect",  ESP_SSID]);
}

function esp_flash() {
  const files = fs
    .readdirSync("./firmware", { encoding: "utf-8" })
    .filter((f) => f.startsWith("0x"))
    .flatMap((f) => [f.replace(".bin", ""), "firmware/" + f]);

  const flash = sh("esptool.py", [
    "--port",
    SERIAL_PORT,
    "--baud",
    "115200",
    "--after",
    "no_reset",
    "write_flash",
    "--compress",
    "--flash_freq",
    "80m",
    "-fm",
    "qio",
    "-fs",
    "1MB",
    ...files,
  ], { encoding: 'utf8' });

  console.log(flash.stdout || flash.output);
  if (flash.status != 0) {
    throw new Error('Flash failed');
  }
}

async function readStream(s) {
  return new Promise(r => {
    const a = [];
    s.on('data', c => a.push(c));
    s.on('end', () => { r(Buffer.concat(a)); });
  });
}

http.createServer(async (req, res) => {
  try {
    console.log(req.method, req.url);
    await serve(req, res);
  } catch (e) {
    console.log(e);
    res.socket.destroy(e);
  }
})
.listen(process.env.PORT, () => {
  console.log('Listening on ' + process.env.PORT);
});

async function serve(req, res) {
  if (req.method === 'GET') {
    const esp = http.request(ESP_URL);
    esp.on('response', r => r.pipe(res));
    esp.end();
    return;
  }

  if (req.method !== 'POST') {
    res.writeHead(404).end();
    return;
  }

  if (req.url.startsWith('/upload/')) {
    const buffer = await readStream(req);
    const f = '/firmware/' + req.url.replace('/upload/', '');
    fs.writeFile(process.cwd() + f, buffer, () => res.writeHead(200).end(f + ' OK\n'));
    return;
  }

  if (req.url === '/prepare') {
    sh('rm', ['firmware/*']);
    res.end();
    return;
  }

  if (req.url === '/reset-to-flash') {
    console.log('reset to flash');
    await esp_reset_flash();
    res.end();
    return;
  }

  if (req.url === '/flash') {
    console.log('reset to flash');
    await esp_reset_flash();
    console.log('flash');
    await esp_flash();
    console.log('reset');
    await esp_reset();
    console.log('done');

    res.writeHead(202);
    res.end();
  }

  if (req.url === '/connect') {
    await esp_connect();
    res.end();
    return;
  }

  if (req.url === '/run') {
    const buffer = await readStream(req);
    console.log('Received %d bytes', buffer.length);
    const r = http.request(ESP_URL, {
      method: 'POST',
      headers: {
        //...req.headers,
        'Content-Length': buffer.length
      }
    });

    r.on('response', (esp) => esp.pipe(res));
    r.write(buffer);
    r.end();
    return;
  }

  if (req.url === '/reset') {
    console.log('reset');
    await esp_reset();
    res.end();
  }
}

