/**
 * Entry point of the client: index.html loads this file.
 *
 * It starts the app inside <div id="app">. If starting fails, the reason is
 * shown on the page instead of leaving it blank.
 */

import './styles.css';
import { startApp } from './ui/app';

const root = document.getElementById('app');
if (root === null) throw new Error('index.html has no element with id "app"');

try {
  startApp(root);
} catch (error) {
  const box = document.createElement('div');
  box.className = 'boot-error';

  const title = document.createElement('h1');
  title.textContent = 'Domination';

  const text = document.createElement('p');
  text.textContent = `The game could not start: ${error instanceof Error ? error.message : String(error)}`;

  box.append(title, text);
  root.replaceChildren(box);
  console.error(error);
}
