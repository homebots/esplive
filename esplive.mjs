import { request, createServer } from "node:http";
import { writeFile, open } from "node:fs/promises";
import { readdirSync, createReadStream } from "node:fs";
import { spawn, spawnSync as sh } from "node:child_process";
import { join } from "node:path";

let _env = null;

async function getEnv() {
  if (!_env) {
    _env = await import(join(process.cwd(), "esplive.conf.mjs"));
  }

  return _env;
}

async function echo(v, f) {
  try {
    // console.log(`${v} > ${f}`);
    await writeFile(f, String(v) + "\n");
  } catch (error) {
    console.log(`Failed to write ${f}:`, error);
  }
}

function sleep(time = 1000) {
  return new Promise((r) => setTimeout(r, time));
}

async function esp_reset() {
  const { SYSFS, GPIO_0, RESET } = await getEnv();
  await esp_iostart();
  await echo(1, `${SYSFS}/gpio${GPIO_0}/value`);
  await echo(1, `${SYSFS}/gpio${RESET}/value`);

  await echo(0, `${SYSFS}/gpio${RESET}/value`);
  await sleep();
  await echo(1, `${SYSFS}/gpio${RESET}/value`);
  await esp_iostop();
}

async function esp_reset_flash() {
  const { SYSFS, GPIO_0, RESET } = await getEnv();
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
  const { SYSFS, GPIO_0, RESET } = await getEnv();
  await echo(RESET, `${SYSFS}/export`);
  await echo(GPIO_0, `${SYSFS}/export`);
  await echo("out", `${SYSFS}/gpio${RESET}/direction`);
  await echo("out", `${SYSFS}/gpio${GPIO_0}/direction`);
  await sleep();
}

async function esp_iostop() {
  const { SYSFS, GPIO_0, RESET } = await getEnv();
  await sleep();
  await echo("in", `${SYSFS}/gpio${RESET}/direction`);
  await echo("in", `${SYSFS}/gpio${GPIO_0}/direction`);
  await echo(RESET, `${SYSFS}/unexport`);
  await echo(GPIO_0, `${SYSFS}/unexport`);
}

async function esp_connect() {
  const { ESP_SSID } = await getEnv();
  sh("nmcli", ["c", "down", ESP_SSID]);
  sh("nmcli", ["c", "up", ESP_SSID]);
  // sh("nmcli", ["dev", "wifi", "connect",  ESP_SSID]);
}

async function esp_flash() {
  const { SERIAL_PORT } = await getEnv();
  const files = 
    readdirSync("./firmware", { encoding: "utf-8" })
    .filter((f) => f.startsWith("0x"))
    .flatMap((f) => [f.replace(".bin", ""), "firmware/" + f]);

  const flash = sh(
    "esptool.py",
    [
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
    ],
    { encoding: "utf8" }
  );

  console.log(flash.stdout || flash.output);
  if (flash.status != 0) {
    throw new Error("Flash failed");
  }
}

async function readStream(s) {
  return new Promise((r) => {
    const a = [];
    s.on("data", (c) => a.push(c));
    s.on("end", () => {
      r(Buffer.concat(a));
    });
  });
}

createServer(async (req, res) => {
  try {
    console.log('[%s] %s %s', new Date().toISOString().slice(0, 19), req.method, req.url);
    await serve(req, res);
  } catch (e) {
    console.log(e);
    res.socket.destroy(e);
  }
}).listen(process.env.PORT, () => {
  console.log("Listening on " + process.env.PORT);
});

async function serve(req, res) {
  const { ESP_URL } = await getEnv();
  const url = new URL(req.url, 'http://localhost');
  const route = `${req.method} ${url.pathname}`;
  
  if (route === "GET /") {
    readSerialOnce(req, res);
    return;
  }  

  if (route === "GET /cat") {
    readSerialPort(req, res);
    return;
  }

  if (route === "GET /buffer") {
    const esp = request(ESP_URL);
    esp.on("response", (r) => r.pipe(res));
    esp.end();
    return;
  }

  if (req.method !== "POST") {
    res.writeHead(404).end();
    return;
  }

  if (req.url.startsWith("/upload/")) {
    const buffer = await readStream(req);
    const f = "/firmware/" + req.url.replace("/upload/", "");
    await writeFile(process.cwd() + f, buffer);
    res.writeHead(200).end(f + " OK\n");
    return;
  }

  if (req.url === "/prepare") {
    sh("rm", ["firmware/*"]);
    res.end();
    return;
  }

  if (req.url === "/reset-to-flash") {
    console.log("reset to flash");
    await esp_reset_flash();
    res.end();
    return;
  }

  if (req.url === "/flash") {
    console.log("reset to flash");
    await esp_reset_flash();
    console.log("flash");
    await esp_flash();
    console.log("reset");
    await esp_reset();
    console.log("done");

    res.writeHead(202);
    res.end();
  }

  if (req.url === "/connect") {
    await esp_connect();
    res.end();
    return;
  }

  if (req.url === "/run") {
    const buffer = await readStream(req);
    console.log("Sending %d bytes to run at %s", buffer.length, ESP_URL);
    // TODO support https? 
    const r = request(ESP_URL, {
      method: "POST",
      headers: {
        //...req.headers,
        "Content-Length": buffer.length,
      },
    });

    r.on("response", (esp) => esp.pipe(res));
    r.write(buffer);
    r.end();
    return;
  }

  if (req.url === "/reset") {
    console.log("reset");
    await esp_reset();
    res.end();
  }

  res.writeHead(404).end('Not found');
}

async function readSerialOnce(req, res) {
  const { SERIAL_PORT } = await getEnv();
  createReadStream(SERIAL_PORT).pipe(res);
}

async function readSerialPort(req, res) {
  const { SERIAL_PORT } = await getEnv();
  const fd = await open(SERIAL_PORT, 'r');
  
  res.setHeader('content-type', 'text/plain');
  res.writeHead(200, 'Reading');
  let reading = true;
  const buffer = Buffer.alloc(128).fill(0);

  const readMore = async () => {
    if (!reading) return;

    const { bytesRead } = await fd.read({ buffer });
    
    if (bytesRead) {
      const slice = buffer.slice(0, bytesRead);
      res.write(slice.toString('utf8'));
      console.log(slice.byteLength);
      buffer.fill(0);
    }

    setTimeout(readMore, 100);
  };

  const onclose = () => {
    console.log('CLOSING');
    reading = false;
    fd.close();
  };

  res.on('end', onclose);
  req.on('close', onclose);
  req.on('error', onclose);

  readMore();
}
