import sharp from 'sharp'
import { readdirSync, statSync } from 'fs'
import path from 'path'

const ROOT = path.resolve(process.cwd(), 'public/assets')

function walk(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry)
    const st = statSync(full)
    if (st.isDirectory()) walk(full, files)
    else if (entry.toLowerCase().endsWith('.png')) files.push(full)
  }
  return files
}

const pngFiles = walk(ROOT)
let totalBefore = 0
let totalAfter = 0

for (const file of pngFiles) {
  const before = statSync(file).size
  const outPath = file.replace(/\.png$/i, '.webp')
  await sharp(file).webp({ quality: 88, alphaQuality: 100 }).toFile(outPath)
  const after = statSync(outPath).size
  totalBefore += before
  totalAfter += after
  console.log(`${path.relative(ROOT, file)}: ${(before/1024).toFixed(0)}KB -> ${(after/1024).toFixed(0)}KB`)
}

console.log('---')
console.log(`Total: ${(totalBefore/1024/1024).toFixed(2)}MB -> ${(totalAfter/1024/1024).toFixed(2)}MB`)
