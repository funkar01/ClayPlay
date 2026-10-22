// Keep the playground expanded across the browser window from startup.
export function setupFullscreen(stage, cancelStroke, { controls = [] } = {}) {
  const button = stage.querySelector('#fullscreen-button');
  const status = stage.querySelector('#fullscreen-status');
  button.hidden = true;
  stage.classList.add('is-expanded', 'is-fullscreen');
  document.body.classList.add('play-area-fullscreen');
  cancelStroke();

  // Keep camera controls available inside the expanded playground.
  const controlDock = document.createElement('div');
  controlDock.className = 'stage-session-controls';
  controlDock.append(...controls);
  stage.append(controlDock);

  // Background page sections should not receive keyboard focus.
  for (let node = stage; node.parentElement && node !== document.body; node = node.parentElement) {
    for (const sibling of node.parentElement.children) {
      if (sibling !== node && sibling instanceof HTMLElement) sibling.inert = true;
    }
  }
  status.textContent = 'Playground fills the window.';
}
