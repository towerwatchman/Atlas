const assert = require("assert");

const { parseGlInfosContent } = require("../electron/scanners/glInfosParser");

const parseGameList = (body) => parseGlInfosContent(`[GameList]\n${body}`);

{
  const result = parseGameList([
    "Version=v0.8.9",
    "ID=8461",
    "Name=Helping the Hotties",
    "Thread=https://f95zone.to/threads/74853",
  ].join("\n"));

  assert.strictEqual(result.f95Id, "74853");
  assert.strictEqual(result.version, "v0.8.9");
  assert.strictEqual(result.title, "Helping the Hotties");
}

{
  const result = parseGameList([
    "Version=v0.8.9",
    "ID=8461",
    "Name=Helping the Hotties",
  ].join("\n"));

  assert.strictEqual(result.f95Id, "");
  assert.strictEqual(result.version, "v0.8.9");
  assert.strictEqual(result.title, "Helping the Hotties");
}

{
  const result = parseGameList([
    "Version=v0.8.9",
    "ID=8461",
    "Name=Helping the Hotties",
    "Thread=https://f95zone.to/threads/not-a-thread",
  ].join("\n"));

  assert.strictEqual(result.f95Id, "");
  assert.strictEqual(result.version, "v0.8.9");
  assert.strictEqual(result.title, "Helping the Hotties");
}

console.log("GL_Infos parser checks passed");
