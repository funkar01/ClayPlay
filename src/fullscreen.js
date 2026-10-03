// Keep the existing stage (and its clay/camera state) when changing view size.
export function setupFullscreen(stage, cancelStroke) {
  const button = stage.querySelector('#fullscreen-button');
  const label = stage.querySelector('#fullscreen-label');
  const status = stage.querySelector('#fullscreen-status');
  let expanded = false;
  let pending = false;
  let background = [];

  function syncView() {
    const active = document.fullscreenElement === stage || expanded;
    const wasActive = button.getAttribute('aria-pressed') === 'true';
    stage.classList.toggle('is-expanded', expanded);
    stage.classList.toggle('is-fullscreen', active);
    document.body.classList.toggle('play-area-fullscreen', active);
    button.setAttribute('aria-pressed', String(active));
    label.textContent = active ? 'Exit full screen' : 'Full screen';
    button.title = active ? 'Exit full screen (Esc)' : 'Expand the play area';

    if (active === wasActive) return;
    cancelStroke();
    if (active) {
      // Also constrain keyboard focus in browsers using the viewport fallback.
      for (let node = stage; node.parentElement && node !== document.body; node = node.parentElement) {
        for (const sibling of node.parentElement.children) {
          if (sibling !== node && sibling instanceof HTMLElement) {
            background.push([sibling, sibling.inert]);
            sibling.inert = true;
          }
        }
      }
      status.textContent = 'Play area expanded. Press Escape to return.';
    } else {
      for (const [element, wasInert] of background) element.inert = wasInert;
      background = [];
      status.textContent = 'Returned to the studio.';
    }
    button.focus({ preventScroll: true });
  }

  async function toggleFullscreen() {
    if (pending) return;
    pending = true;
    try {
      if (document.fullscreenElement === stage) {
        await document.exitFullscreen();
      } else if (expanded) {
        expanded = false;
      } else {
        // Embedded browsers may disallow native fullscreen. Still fill the tab.
        if (document.fullscreenEnabled && stage.requestFullscreen) {
          try {
            await stage.requestFullscreen();
          } catch {
            expanded = true;
          }
        } else {
          expanded = true;
        }
      }
      syncView();
    } catch {
      status.textContent = 'Use Escape to exit full screen.';
    } finally {
      pending = false;
    }
  }

  button.addEventListener('click', toggleFullscreen);
  document.addEventListener('fullscreenchange', syncView);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && (expanded || document.fullscreenElement === stage)) {
      event.preventDefault();
      void toggleFullscreen();
    }
  });
}
