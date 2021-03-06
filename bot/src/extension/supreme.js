import $ from 'jquery';
import BaseManager from './BaseManager';
import * as Helpers from '../app/utils/Helpers';
import * as InputProcessor from './InputProcessor';
import * as SupremeUtils from '../app/utils/SupremeUtils';

export default class SupremeManager extends BaseManager {
  constructor(preferences, sizings, billing) {
    super();
    this.preferences = preferences;
    this.sizings = sizings;
    this.billing = billing;
  }

  /**
   * This function is called whenever a new page change occurs
   */
  async onPageChange() {
    this.processLinks();

    // if stores are not configured yet..
    if (!this.isConfigured()) {
      this.setNotificationBarText('Bot not yet configured');
      return;
    }
    const hideSoldOut = this.preferences.hideSoldOut;
    this.processSoldOutProducts(hideSoldOut);

    const autoCheckout = this.preferences.autoCheckout;
    const autoPay = this.preferences.autoPay;
    this.setNotificationBarText('AutoCheckout ' + (autoCheckout ? 'enabled' : 'disabled') + ', AutoPay ' + (autoPay ? 'enabled' : 'disabled'));
    if (!this.preferences.autoCheckout) return;
    if (this.isProductPage()) {
      this.processProduct();
    } else if (this.isCart()) {
      this.processCart();
    } else if (this.isCheckout()) {
      this.processCheckout();
    } else if (this.isShopCategoryPage()) {
      this.processAtc();
    }
  }

  isConfigured() {
    return !([this.preferences, this.sizings, this.billing].some(x => x === undefined));
  }

  /**
   * Attach an event on product links of the page to reload the page instead of loading in ajax
   */
  processLinks() {
    const links = document.links;

    for (let link of links) {
      link.addEventListener('click', function (e) {
        window.location.href = this.href;
        if (!e)
          e = window.event;

        if (e.stopPropagation) {
          e.stopPropagation();
        }
        else {
          e.cancelBubble = true;
        }
      });
    }
  }

  processSoldOutProducts(hideSoldOut) {
    Array.prototype.forEach.call(document.getElementsByClassName('sold_out_tag'), x => x.style.display = 'block');
    if (hideSoldOut) {
      let sold_outs = Array.prototype.filter.call(document.getElementsByTagName('article'), x => x.getElementsByClassName('sold_out_tag').length);
      for (let node of sold_outs) {
        node.remove();
      }
    }
  }

  /**
   * This function should be called when the user is on the 'cart' page, it will then redirect the user
   * to the checkout page after the delay configured in the options
   * @param  {Object} preferencesStore Object that stores the preference options
   */
  processCart() {
    const outOfStockItems = document.querySelectorAll('.out_of_stock');
    const outOfStockAction = this.preferences.onCartSoldOut;
    if (!outOfStockItems.length) {
      this.timeout(() => {
        document.location.href = '/checkout';
      }, 100, 'Going to checkout');
      return;
    }
    if (outOfStockAction === SupremeUtils.OnSoldOutCartActions.STOP) {
      this.setNotificationBarText('A product is sold out, aborting...');
    } else if (outOfStockAction === SupremeUtils.OnSoldOutCartActions.REMOVE_SOLD_OUT_PRODUCTS) {
      const promises = [];
      for (let product of outOfStockItems) {
        const form = product.querySelector('form');
        if (form) {
          promises.push(new Promise((resolve, reject) => {
            $.ajax({
              type: 'POST',
              url: $(form).attr('action'),
              data: $(form).serializeArray(),
              success: resolve,
              error: reject,
            });
          }));
        }
      }
      Promise.all(promises).then(() => {
        this.timeout(() => {
          document.location.href = '/checkout';
        }, 100, 'Going to checkout');
      });
    }
  }

  /**
   * This function should be called when the user is on the 'checkout' page, it will fill
   * the checkout form with the values defined by the user in the options and then checkout after a delay
   * @param  {Object} preferencesStore Object that stores the preference options
   * @param  {Object} billingStore Object that stores the billings options
   */
  processCheckout() {
    const checkoutDelay = this.preferences.checkoutDelay;
    const inputs = [...document.querySelectorAll('input, textarea, select')]
      .filter(x => ['hidden', 'submit', 'button', 'checkbox'].indexOf(x.type) === -1);
    InputProcessor.processFields(inputs, this.billing);
    const terms = document.getElementsByName('order[terms]');
    if (terms.length) {
      terms[0].click();
    }

    if (this.preferences.captchaBypass) {
      let captcha = document.querySelector('.g-recaptcha');
      if (captcha) {
        captcha.remove();
      }
    }
    if (this.preferences.autoPay) {
      this.timeout(() => {
        const commitBtn = document.getElementsByName('commit')[0];
        if (commitBtn) {
          commitBtn.click();
        }
      }, checkoutDelay, 'Checking out');
    }
  }

  /**
   * This function should be called when the user is on a product page, it will
   * try to figure out if the product is sold out or not, and if not, it will find the best available size
   * based on the user's preferences and then it will add the item to cart
   */
  processProduct() {
    if (!this.isSoldOut()) {
      let maxPrice = this.preferences.maxPrice;
      let minPrice = this.preferences.minPrice;
      let itemPrice = document.querySelector('[itemprop=price]');


      if (itemPrice !== null) {
        let price = +(itemPrice.innerHTML.replace(/\D/g, ''));
        if (!isNaN(price)) {
          if (maxPrice !== undefined && price > maxPrice) {
            this.setNotificationBarText('Product price is too high, not checking out');
            return;
          }

          if (minPrice !== undefined && price < minPrice) {
            this.setNotificationBarText('Product price is too low, not checking out');
            return;
          }
        }
      }

      let submitBtn = document.querySelector('[name=commit]');
      let productCategory = this.getProductCategory();
      let sizesOptions = this.getSizesOptions();

      // If sizes options are available
      if (sizesOptions.length) {
        let categorySize = this.sizings[productCategory];
        if (categorySize === undefined) {
          this.setNotificationBarText(`Unknown category "${productCategory}", cannot process`);
          return;
        }
        let targetOption = sizesOptions.find(x => this.sizeMatch(categorySize, x.text, productCategory));

        if (!targetOption) {
          if (this.preferences.strictSize) {
            this.setNotificationBarText('The desired size is not available');
            return;
          }
          targetOption = sizesOptions[0];
        }
        targetOption.selected = true;
      }

      let atcDelay = this.preferences.addToCartDelay;
      this.timeout(() => {
        const process = () => {
          if (document.querySelector('.in-cart') && document.getElementById('cart')) {
            setTimeout(() => {
              window.location.href = '/checkout';
            }, 200);
          } else {
            submitBtn.click();
            this.timeout(() => process(), 500, 'Waiting for product to be in cart...');
          }
        };

        process();
      }, atcDelay, 'Adding to cart');
    }
  }

  findArticles() {
    let articles = document.querySelectorAll('.inner-article');
    if (!articles.length) {
      articles = document.querySelectorAll('.inner-item');
    }
    return [...articles];
  }

  getArticleName(article) {
    const nameNode = article.querySelector('h1') || article.querySelector('a.nl') || article.querySelector('a');
    return nameNode ? nameNode.innerText.toLowerCase().trim() : null;
  }

  getArticleColor(article) {
    const colorNode = article.querySelector('.sn') || article.querySelector('.nl');
    return colorNode ? colorNode.innerText.toLowerCase().trim() : null;
  }

  processAtc() {
    const queryString = Helpers.getQueryStringValue('atc-kw');
    if (!queryString) {
      return;
    }
    const keywords = queryString.split(';');
    const kwColor = Helpers.getQueryStringValue('atc-color');
    const innerArticles = this.findArticles();
    const products = [];
    for (let i = 0; i < innerArticles.length; i += 1) {
      const name = this.getArticleName(innerArticles[i]);
      const a = innerArticles[i].querySelector('a');
      const color = this.getArticleColor(innerArticles[i]);
      const soldOut = innerArticles[i].getElementsByClassName('sold_out_tag');
      if (soldOut.length) {
        continue;
      }
      if (name && a.href) {
        const product = {
          matches: 0,
          url: a.href,
        };
        for (let j = 0; j < keywords.length; j += 1) {
          const keyword = keywords[j].toLowerCase().trim();
          const regexp = new RegExp(keyword);
          // name matches
          if (regexp.test(name)) {
            if (kwColor && color) {
              const regexColor = new RegExp(color);
              if (regexColor.test(kwColor.toLowerCase().trim())) {
                product.matches += 1;
              }
            }
            product.matches += 1;
          }
        }

        products.push(product);
      }
    }
    const bestMatch = products.filter(x => x.matches > 0).sort((a, b) => b.matches - a.matches)[0];
    if (bestMatch) {
      window.location.href = bestMatch.url;
    } else {
      setTimeout(() => {
        window.location.reload();
      }, 1000);
    }
  }

  isShopCategoryPage() {
    return Helpers.hasStringInPath('shop') && Helpers.hasStringInPath('all') && Helpers.pathCount() === 3;
  }

  /**
   * Check if the user is currently on a product page
   */
  isProductPage() {
    return Helpers.hasStringInPath('shop') && (Helpers.pageHasNodeOfClass('styles')
      || Helpers.pageHasNodeOfClass('price')
      || Helpers.pageHasNodeOfClass('style'));
  }

  /**
   * Check if the user is currently on the 'cart' page
   */
  isCart() {
    return Helpers.pageHasNodeOfClass('cart') && Helpers.hasStringInPath('cart');
  }

  /**
   * Check if the user is currently at the checkout page
   */
  isCheckout() {
    return Helpers.hasStringInPath('checkout');
  }

  /**
   * Returns the product category when the user is on a product page
   */
  getProductCategory() {
    const category = Helpers.getQueryStringValue('atc-category');
    return !category ? location.pathname.substring(1).split('/')[1] : category;
  }

  /**
   * Check if the current product is sold out
   * @return {Boolean}
   */
  isSoldOut() {
    return document.querySelector('input[name=commit]') === null;
  }

  /**
   * Return the available sizes for the current product
   * @return {Array}
   */
  getSizesOptions() {
    const sizes = document.getElementById('size') ||  document.querySelector('[name=size]') || (document.querySelector('form.add').querySelector('select'));
    if (!sizes || !sizes.options)
      return [];
    return [...sizes.options];
  }
}
