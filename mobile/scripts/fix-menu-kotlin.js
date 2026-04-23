const fs = require('fs');
const path = require('path');

const base = path.resolve(__dirname, '..');
console.log('[fix-menu-kotlin] Running from:', base);
console.log('[fix-menu-kotlin] Node version:', process.version);
console.log('[fix-menu-kotlin] CWD:', process.cwd());

const filesToFix = [
  {
    file: 'node_modules/@react-native-menu/menu/android/src/main/java/com/reactnativemenu/MenuView.kt',
    lines: [28],
  },
  {
    file: 'node_modules/@react-native-menu/menu/android/src/main/java/com/reactnativemenu/MenuViewManagerBase.kt',
    lines: [126, 128, 209],
  },
];

// Try multiple base paths since EAS might run from different directories
const possibleBases = [
  base,
  process.cwd(),
  path.resolve(process.cwd(), '..'),
  '/home/expo/workingdir/build/mobile',
];

let fixed = false;

for (const baseDir of possibleBases) {
  console.log('[fix-menu-kotlin] Trying base:', baseDir);
  
  for (const { file, lines } of filesToFix) {
    const fullPath = path.join(baseDir, file);
    
    if (!fs.existsSync(fullPath)) {
      console.log('[fix-menu-kotlin] Not found:', fullPath);
      continue;
    }
    
    console.log('[fix-menu-kotlin] Found:', fullPath);
    const rows = fs.readFileSync(fullPath, 'utf8').split('\n');
    let changed = false;
    
    lines.forEach(n => {
      const i = n - 1;
      const original = rows[i];
      console.log('[fix-menu-kotlin] Line ' + n + ':', JSON.stringify(original));
      
      if (original && original.includes(' val ')) {
        rows[i] = original.replace(' val ', ' var ');
        console.log('[fix-menu-kotlin] Fixed to:', JSON.stringify(rows[i]));
        changed = true;
        fixed = true;
      } else if (original && original.match(/^\s+val\s+/)) {
        // Handle "    val x" pattern (val at start after whitespace)
        rows[i] = original.replace(/^(\s+)val(\s+)/, '$1var$2');
        console.log('[fix-menu-kotlin] Fixed (pattern2) to:', JSON.stringify(rows[i]));
        changed = true;
        fixed = true;
      }
    });
    
    if (changed) {
      fs.writeFileSync(fullPath, rows.join('\n'), 'utf8');
      console.log('[fix-menu-kotlin] Saved:', fullPath);
    }
  }
  
  if (fixed) break;
}

if (!fixed) {
  console.log('[fix-menu-kotlin] WARNING: No files were fixed. Dumping environment info:');
  console.log('[fix-menu-kotlin] __dirname:', __dirname);
  console.log('[fix-menu-kotlin] process.cwd():', process.cwd());
  
  // Last resort: find the file anywhere
  try {
    const { execSync } = require('child_process');
    const result = execSync('find / -name "MenuView.kt" -path "*/reactnativemenu/*" 2>/dev/null || true').toString();
    console.log('[fix-menu-kotlin] find result:', result);
    
    if (result.trim()) {
      const foundPaths = result.trim().split('\n');
      for (const foundPath of foundPaths) {
        if (!fs.existsSync(foundPath)) continue;
        console.log('[fix-menu-kotlin] Fixing found file:', foundPath);
        let content = fs.readFileSync(foundPath, 'utf8');
        const rows = content.split('\n');
        const i = 27; // line 28, 0-indexed
        console.log('[fix-menu-kotlin] Line 28:', JSON.stringify(rows[i]));
        if (rows[i] && rows[i].match(/\bval\b/)) {
          rows[i] = rows[i].replace(/\bval\b/, 'var');
          fs.writeFileSync(foundPath, rows.join('\n'), 'utf8');
          console.log('[fix-menu-kotlin] Fixed MenuView.kt');
        }
      }
    }
    
    const result2 = execSync('find / -name "MenuViewManagerBase.kt" -path "*/reactnativemenu/*" 2>/dev/null || true').toString();
    if (result2.trim()) {
      const foundPaths = result2.trim().split('\n');
      for (const foundPath of foundPaths) {
        if (!fs.existsSync(foundPath)) continue;
        console.log('[fix-menu-kotlin] Fixing found file:', foundPath);
        let rows = fs.readFileSync(foundPath, 'utf8').split('\n');
        [125, 127, 208].forEach(i => {
          console.log('[fix-menu-kotlin] Line ' + (i+1) + ':', JSON.stringify(rows[i]));
          if (rows[i] && rows[i].match(/\bval\b/)) {
            rows[i] = rows[i].replace(/\bval\b/, 'var');
            console.log('[fix-menu-kotlin] Fixed line', i+1);
          }
        });
        fs.writeFileSync(foundPath, rows.join('\n'), 'utf8');
      }
    }
  } catch (e) {
    console.log('[fix-menu-kotlin] find error:', e.message);
  }
}

console.log('[fix-menu-kotlin] Done.');