const fs = require('fs');
const path = require('path');

const base = path.resolve(__dirname, '..');

const fixes = [
  {
    file: 'node_modules/@react-native-menu/menu/android/src/main/java/com/reactnativemenu/MenuView.kt',
    line: 28,
  },
  {
    file: 'node_modules/@react-native-menu/menu/android/src/main/java/com/reactnativemenu/MenuViewManagerBase.kt',
    lines: [126, 128, 209],
  },
];

fixes.forEach(({ file, line, lines }) => {
  const fullPath = path.join(base, file);
  if (!fs.existsSync(fullPath)) {
    console.log('NOT FOUND: ' + fullPath);
    return;
  }
  const rows = fs.readFileSync(fullPath, 'utf8').split('\n');
  const targets = line ? [line] : lines;
  let changed = false;
  targets.forEach(n => {
    const i = n - 1;
    if (rows[i] && rows[i].includes(' val ')) {
      rows[i] = rows[i].replace(' val ', ' var ');
      console.log('Fixed line ' + n + ' in ' + file);
      changed = true;
    } else {
      console.log('Line ' + n + ': ' + (rows[i] || 'UNDEFINED'));
    }
  });
  if (changed) fs.writeFileSync(fullPath, rows.join('\n'), 'utf8');
});
