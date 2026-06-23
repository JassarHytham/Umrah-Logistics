const test = globalThis.test || require('node:test').test;
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const contentPath = path.join(__dirname, '..', 'content.js');
const contentSource = fs.readFileSync(contentPath, 'utf8');

function makeHarness() {
  const storageWrites = [];
  let clickHandler = null;

  const cells = {
    groupNumber: '480900139756',
    groupName: 'Amirah July Grp 1',
    mutamerNumber: '6',
    eaName: 'اميرة ترافيل',
  };

  const row = {
    style: {},
    querySelector(selector) {
      const match = selector.match(/td\[id="([^"]+)"\]/);
      const id = match && match[1];
      return id && cells[id] !== undefined ? { textContent: cells[id] } : null;
    },
  };

  const button = {
    tagName: 'BUTTON',
    innerHTML: '<i class="pi pi-cog"></i>',
    closest(selector) {
      return selector === 'tr' ? row : null;
    },
  };

  const context = {
    window: {
      __umrahCaptureInjected: false,
      UmrahAutoLogic: null,
    },
    location: { href: 'https://masar.nusuk.sa/umrah/mutamer-group', pathname: '/umrah/mutamer-group' },
    document: {
      body: {},
      addEventListener(type, handler) {
        if (type === 'click') clickHandler = handler;
      },
    },
    MutationObserver: class {
      observe() {}
    },
    setInterval() {},
    setTimeout(callback) {
      callback();
      return 1;
    },
    console: { log() {}, error() {} },
    chrome: {
      runtime: { lastError: null },
      storage: {
        local: {
          set(payload, callback) {
            storageWrites.push(payload);
            if (callback) callback();
          },
        },
      },
    },
  };

  vm.runInNewContext(contentSource, context, { filename: contentPath });

  return {
    storageWrites,
    clickGroupCog() {
      clickHandler({
        composedPath() {
          return [button, row];
        },
        target: button,
      });
    },
  };
}

test('group row capture persists agency to autofill and active group storage', () => {
  const harness = makeHarness();

  harness.clickGroupCog();

  assert.strictEqual(harness.storageWrites.length, 1);
  assert.strictEqual(harness.storageWrites[0].umrah_autofill.agency, 'اميرة ترافيل');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(harness.storageWrites[0].umrah_active_group)), {
    groupNo: '480900139756',
    groupName: 'Amirah July Grp 1',
    agency: 'اميرة ترافيل',
    count: '6',
  });
});
