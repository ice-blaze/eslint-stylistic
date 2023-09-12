import { basename, dirname, join, relative, resolve } from 'node:path'
import process from 'node:process'
import fs from 'node:fs/promises'
import { createRequire } from 'node:module'
import fg from 'fast-glob'

const require = createRequire(import.meta.url)

interface RuleInfo {
  name: string
  ruleId: string
  entry: string
  docsEntry: string
  meta?: RuleMeta
}

interface PackageInfo {
  name: string
  pkgId: string
  shortId: string
  rules: RuleInfo[]
  path: string
}

interface RuleMeta {
  fixable?: 'code' | 'whitespace'
  docs?: {
    description?: string
    recommended?: boolean
  }
}

const cwd = process.cwd()

async function run() {
  const paths = await fg('./packages/*/package.json', {
    onlyFiles: true,
    absolute: true,
    ignore: [
      'node_modules',
    ],
  })

  const packages = await Promise.all(paths.map(i => readPackage(dirname(i))))

  await Promise.all(packages.flatMap(i => [
    writeRulesIndex(i),
    writeREADME(i),
  ]))

  await writeVitePressRewrite(packages)
}

run()

async function readPackage(path: string): Promise<PackageInfo> {
  const pkgId = relative(join(cwd, 'packages'), path).replace('eslint-plugin-', '')
  const shortId = pkgId.replace('stylistic-', '')
  const pkgJSON = JSON.parse(await fs.readFile(join(path, 'package.json'), 'utf-8'))
  console.log(`Preparing ${path}`)
  const rulesDir = await fg('rules/*', {
    cwd: path,
    onlyDirectories: true,
  })

  const rules = await Promise.all(
    rulesDir.map(async (ruleDir) => {
      const name = basename(ruleDir)
      const meta = require(resolve(path, ruleDir, `${name}.js`)).meta
      const rule: RuleInfo = {
        name,
        ruleId: `${pkgId}/${name}`,
        // TODO: check if entry exists
        entry: resolve(path, ruleDir, `${name}.js`),
        // TODO: check if entry exists
        docsEntry: resolve(path, ruleDir, 'README.md'),
        meta,
      }
      return rule
    }))

  return {
    name: pkgJSON.name,
    shortId,
    pkgId,
    path,
    rules,
  }
}

async function writeRulesIndex(pkg: PackageInfo) {
  if (!pkg.rules.length)
    return

  const ruleDir = join(pkg.path, 'rules')

  const index = `module.exports = {\n${pkg.rules.map(i => `  '${i.name}': () => require('./${relative(ruleDir, i.entry)}'),`).join('\n')}\n}\n`

  await fs.mkdir(ruleDir, { recursive: true })
  await fs.writeFile(join(ruleDir, 'index.js'), index, 'utf-8')
}

async function writeREADME(pkg: PackageInfo) {
  if (!pkg.rules.length)
    return

  const lines = [
    `# ${pkg.name}`,
    '',
    '| Rule ID | Description | Fixable | Recommended |',
    '| --- | --- | --- | --- |',
    ...pkg.rules.map(i => `| [\`${i.ruleId}\`](./rules/${i.name}) | ${i.meta?.docs?.description || ''} | ${i.meta?.fixable ? '✅' : ''} | ${i.meta?.docs?.recommended ? '✅' : ''} |`),
  ]

  await fs.writeFile(join(pkg.path, 'rules.md'), lines.join('\n'), 'utf-8')
}

async function writeVitePressRewrite(packages: PackageInfo[]) {
  const lines = packages
    .flatMap(pkg => pkg.rules
      .map(i => `  '${relative(cwd, i.docsEntry)}': 'rules/${pkg.shortId}/${i.name}.md',`),
    )

  const index = `export default {\n${lines.join('\n')}\n}\n`

  await fs.writeFile(join(cwd, 'docs', '.vitepress', 'rewrite.mts'), index, 'utf-8')
}
