import test from 'node:test';
import assert from 'node:assert/strict';
import {createAppServer} from '../serve.mjs';

test('Сервер выдаёт сайт, не принимает загрузки и не раскрывает файлы проекта', async () => {
  const server = createAppServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  try {
    const home = await fetch(url);
    assert.equal(home.status, 200);
    assert.match(await home.text(), /Лея/);
    assert.equal((await fetch(url + '/schema.json')).status, 200);
    assert.equal((await fetch(url + '/README.md')).status, 404);
    assert.equal((await fetch(url + '/%2e%2e%2fpackage.json')).status, 403);
    assert.equal((await fetch(url, {method: 'POST', body: 'synthetic'})).status, 405);
    assert.equal(await (await fetch(url, {method: 'HEAD'})).text(), '');
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});
