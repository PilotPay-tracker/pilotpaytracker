const fs = require('fs');
const path = require('path');

const files = [
  'node_modules/@react-native-menu/menu/android/src/main/java/com/reactnativemenu/MenuView.kt',
  'node_modules/@react-native-menu/menu/android/src/main/java/com/reactnativemenu/MenuViewManagerBase.kt',
];

files.forEach(filePath => {
  const fullPath = path.resolve(__dirname, '..', filePath);
  if (!fs.existsSync(fullPath)) return;
  
  let content = fs.readFileSync(fullPath, 'utf8');
  const original = content;
  
  // Fix val -> var for reassignable properties
  content = content.replace(/(\s+)val (menuItems)(\s*[:=])/g, '$1var $2$3');
  content = content.replace(/(\s+)val (item\b)(\s*=)/g, '$1var $2$3');
  content = content.replace(/(\s+)val (subactions\b)(\s*=)/g, '$1var $2$3');
  content = content.replace(/(\s+)val (params\b)(\s*=)/g, '$1var $2$3');
  
  if (content !== original) {
    fs.writeFileSync(fullPath, content, 'utf8');
    console.log(`Fixed: ${filePath}`);
  } else {
    console.log(`No changes needed: ${filePath}`);
  }
});