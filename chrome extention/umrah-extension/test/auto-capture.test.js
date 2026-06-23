const test = globalThis.test || require('node:test').test;
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const autoCapturePath = path.join(__dirname, '..', 'auto-capture.js');
const autoCaptureSource = fs.readFileSync(autoCapturePath, 'utf8');
const autoLogic = require('../auto-logic.js');

function makeTextNode(value) {
  return { nodeType: 3, nodeValue: value };
}

function makeElement(tagName, children = []) {
  return {
    nodeType: 1,
    tagName,
    children,
    className: '',
    id: '',
    type: '',
    value: '',
    style: {},
    setAttribute() {},
    appendChild(child) { this.children.push(child); },
    remove() {},
    querySelector() { return null; },
  };
}

function makeHarness() {
  const observers = [];
  const sentMessages = [];
  const validTripText = [
    'رحلة الوصول',
    'تاريخ الوصول: 2026-07-08',
    'المطار: JED',
    'رقم الرحلة: SV123',
    'معلومات الفندق والخدمات'.repeat(8),
    'رحلة المغادرة',
    'تاريخ المغادرة: 2026-07-15',
  ].join('\n');
  const tripRoot = makeElement('APP-TRIP-INFO', [makeTextNode(validTripText)]);
  const body = makeElement('BODY');

  const document = {
    body,
    currentTripRoot: tripRoot,
    querySelector(selector) {
      return selector === 'app-trip-info' ? this.currentTripRoot : null;
    },
    createElement(tagName) {
      return makeElement(tagName.toUpperCase());
    },
    createTextNode(value) {
      return makeTextNode(value);
    },
    createTreeWalker(root) {
      const nodes = [];
      function visit(node) {
        nodes.push(node);
        if (node.children) node.children.forEach(visit);
      }
      visit(root);
      let index = 0;
      return {
        nextNode() {
          return nodes[index++] || null;
        },
      };
    },
  };

  const context = {
    window: { UmrahAutoLogic: autoLogic, addEventListener() {} },
    self: null,
    globalThis: null,
    document,
    NodeFilter: { SHOW_ELEMENT: 1, SHOW_TEXT: 4, FILTER_REJECT: 2, FILTER_ACCEPT: 1 },
    Node: { ELEMENT_NODE: 1, TEXT_NODE: 3 },
    MutationObserver: class {
      constructor(callback) {
        this.callback = callback;
        observers.push(this);
      }
      observe() {}
      disconnect() {}
    },
    clearTimeout() {},
    setTimeout() {
      return 1;
    },
    chrome: {
      storage: {
        local: {
          get(keys, callback) {
            const data = { umrah_auto_enabled: true };
            if (typeof callback === 'function') callback(data);
            return Promise.resolve(data);
          },
          set() {
            return Promise.resolve();
          },
          remove() {
            return Promise.resolve();
          },
        },
        onChanged: { addListener() {} },
      },
      runtime: {
        sendMessage(message) {
          sentMessages.push(message);
          return Promise.resolve({ result: 'sent', rows: 1 });
        },
      },
    },
  };
  context.self = context.window;
  context.globalThis = context.window;

  vm.runInNewContext(autoCaptureSource, context, { filename: autoCapturePath });

  return {
    document,
    observers,
    sentMessages,
    async leaveTripPage() {
      document.currentTripRoot = null;
      observers.forEach((observer) => observer.callback([]));
      await new Promise((resolve) => setImmediate(resolve));
    },
  };
}

test('auto capture sends current trip text when leaving before debounce snapshot fires', async () => {
  const harness = makeHarness();

  await harness.leaveTripPage();

  assert.strictEqual(harness.sentMessages.length, 1);
  assert.strictEqual(harness.sentMessages[0].type, 'UMRAH_AUTO_FINALIZE');
  assert.match(harness.sentMessages[0].text, /رحلة الوصول/);
  assert.match(harness.sentMessages[0].text, /رحلة المغادرة/);
});
