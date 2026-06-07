const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadI18nModule({ locales = {}, initialLocale = 'vi-VN' } = {}) {
  const scriptPath = path.join(__dirname, '..', 'shared', 'i18n.js');
  const source = fs.readFileSync(scriptPath, 'utf8');

  const context = {
    console,
    window: {
      GUJUMPGATE_LOCALES: locales,
      GUJUMPGATE_LOCALE: initialLocale,
    },
    document: {
      documentElement: {
        lang: 'zh-CN',
      },
      title: '',
      querySelectorAll: () => [],
    },
  };
  context.globalThis = context.window;
  vm.createContext(context);
  vm.runInContext(source, context, { filename: scriptPath });
  return context.window.GuJumpgateI18n;
}

test('createI18n translates nested keys, falls back, and interpolates params', () => {
  const i18n = loadI18nModule({
    locales: {
      'zh-CN': {
        buttons: {
          auto: '自动',
        },
      },
      'vi-VN': {
        buttons: {
          auto: 'Tự động',
        },
        status: {
          waiting: 'Đang chờ {count}',
        },
      },
    },
  });

  assert.equal(i18n.getLocale(), 'vi-VN');
  assert.equal(i18n.t('buttons.auto'), 'Tự động');
  assert.equal(i18n.t('status.waiting', { count: '3 lượt' }), 'Đang chờ 3 lượt');
  assert.equal(i18n.t('missing.key', {}, 'Giá trị dự phòng'), 'Giá trị dự phòng');

  i18n.setLocale('zh-CN');
  assert.equal(i18n.t('buttons.auto'), '自动');
});

test('applyTranslations updates text, title, placeholder and aria-label attributes', () => {
  const nodes = [];
  const createNode = (dataset) => {
    const node = {
      dataset,
      textContent: '',
      placeholder: '',
      title: '',
      attributes: {},
      setAttribute(name, value) {
        this.attributes[name] = value;
      },
    };
    nodes.push(node);
    return node;
  };

  const titleNode = createNode({ i18n: 'header.guide' });
  const placeholderNode = createNode({ i18nPlaceholder: 'form.emailPlaceholder' });
  const titleAttrNode = createNode({ i18nTitle: 'header.repoTitle' });
  const ariaNode = createNode({ i18nAriaLabel: 'header.repoTitle' });

  const scriptPath = path.join(__dirname, '..', 'shared', 'i18n.js');
  const source = fs.readFileSync(scriptPath, 'utf8');
  const context = {
    console,
    window: {
      GUJUMPGATE_LOCALES: {
        'vi-VN': {
          header: {
            guide: 'Hướng dẫn sử dụng',
            repoTitle: 'Mở kho GitHub',
          },
          form: {
            emailPlaceholder: 'Nhập email',
          },
        },
      },
      GUJUMPGATE_LOCALE: 'vi-VN',
    },
    document: {
      documentElement: {
        lang: 'zh-CN',
      },
      title: '',
      querySelectorAll(selector) {
        if (selector === '[data-i18n]') return nodes.filter((node) => node.dataset.i18n);
        if (selector === '[data-i18n-placeholder]') return nodes.filter((node) => node.dataset.i18nPlaceholder);
        if (selector === '[data-i18n-title]') return nodes.filter((node) => node.dataset.i18nTitle);
        if (selector === '[data-i18n-aria-label]') return nodes.filter((node) => node.dataset.i18nAriaLabel);
        return [];
      },
    },
  };
  context.globalThis = context.window;
  vm.createContext(context);
  vm.runInContext(source, context, { filename: scriptPath });

  const i18n = context.window.GuJumpgateI18n;
  i18n.applyTranslations();

  assert.equal(titleNode.textContent, 'Hướng dẫn sử dụng');
  assert.equal(placeholderNode.placeholder, 'Nhập email');
  assert.equal(titleAttrNode.title, 'Mở kho GitHub');
  assert.equal(ariaNode.attributes['aria-label'], 'Mở kho GitHub');
  assert.equal(context.document.documentElement.lang, 'vi-VN');
});
