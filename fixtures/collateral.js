// Synthetic negative control: the page reacts to a changed button width.
const button = document.querySelector('.checkout-button');
const originalWidth = button.getBoundingClientRect().width;
new ResizeObserver(() => {
  if (button.getBoundingClientRect().width === originalWidth) return;
  const sheet = document.styleSheets[0];
  sheet.insertRule('.checkout { outline: 2px solid #e09062; }', sheet.cssRules.length);
}).observe(button, { box: 'border-box' });
