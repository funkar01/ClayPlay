import { MASK_SHAPES } from './clayShapes.js';

const palette = [
  ['Terracotta', '#bd7455'], ['Cream', '#ead5b5'], ['Rose', '#ce8793'],
  ['Sage', '#83a58b'], ['Ocean', '#6e9fba'], ['Lavender', '#a18db6'],
];

export function setupClayMenu(objects, { onSelect, onLayout, onPause }) {
  const menu = document.querySelector('#clay-menu');
  const picker = document.querySelector('#clay-object');
  const color = document.querySelector('#clay-color');
  const swatches = document.querySelector('#clay-swatches');
  const shapeGrid = document.querySelector('#shape-grid');
  const status = document.querySelector('#clay-menu-status');
  const remove = document.querySelector('#remove-clay');
  const selectionName = document.querySelector('#selected-clay-name');
  let busy = false;

  shapeGrid.innerHTML = Object.entries(MASK_SHAPES).map(([key, shape]) =>
    `<button type="button" class="shape-option" data-shape="${key}" aria-label="Add ${shape.label.toLowerCase()}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="${shape.icon}"/></svg><span>${shape.label}</span></button>`).join('');
  swatches.innerHTML = palette.map(([name, hex]) =>
    `<button type="button" class="clay-swatch" data-color="${hex}" style="--swatch:${hex}" aria-label="${name}" aria-pressed="false" title="${name}"></button>`).join('');

  function refresh() {
    picker.replaceChildren(...objects.items.map((item) => new Option(item.label, String(item.id))));
    picker.value = String(objects.active.id);
    color.value = `#${objects.active.material.color.getHexString()}`;
    selectionName.textContent = objects.active.label;
    document.querySelector('#clay-object-count').textContent = String(objects.items.length);
    remove.disabled = objects.items.length === 1 || busy;
    shapeGrid.querySelectorAll('button').forEach((button) => { button.disabled = busy || objects.items.length >= objects.limit; });
    swatches.querySelectorAll('button').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.color === color.value)));
  }

  menu.addEventListener('toggle', () => onPause(menu.open));
  menu.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && menu.open) {
      event.stopPropagation();
      menu.open = false;
      menu.querySelector('summary').focus();
    }
  });
  document.querySelector('#three-scene').addEventListener('pointerdown', () => { menu.open = false; });

  shapeGrid.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-shape]');
    if (!button || busy || objects.items.length >= objects.limit) return;
    busy = true;
    const shape = button.dataset.shape;
    status.textContent = `Adding ${MASK_SHAPES[shape].label.toLowerCase()}…`;
    refresh();
    // Paint the pending state before generating the sculptable surface.
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    try {
      const item = objects.add(shape, color.value);
      onLayout();
      onSelect(item.id);
      status.textContent = objects.items.length === objects.limit ? 'Eight masks on your table. Remove one to add another.' : `${item.label} added. Your other masks are kept.`;
    } catch (error) {
      console.error('Could not add mask:', error);
      status.textContent = 'Could not add this mask. Please try again.';
    } finally {
      busy = false;
      refresh();
    }
  });
  picker.addEventListener('change', () => onSelect(picker.value));
  function setColor(hex) {
    objects.active.material.color.set(hex);
    refresh();
  }
  color.addEventListener('input', () => setColor(color.value));
  swatches.addEventListener('click', (event) => {
    const button = event.target.closest('[data-color]');
    if (button) setColor(button.dataset.color);
  });
  remove.addEventListener('click', () => {
    const name = objects.active.label;
    objects.removeActive();
    onLayout();
    onSelect(objects.active.id);
    status.textContent = `${name} removed.`;
    refresh();
  });
  refresh();
  return { refresh, get isOpen() { return menu.open; } };
}
