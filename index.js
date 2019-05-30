#!/usr/bin/env node

const fs = require('fs')
const path = require('path')
const debug = require('debug')
const {merge} = require('lodash')
const gh = require('github-url-to-object')
const handlebars = require('handlebars')
const npmPackage = require('package-info')
const findUp = require('find-up')
const updateNotifier = require('update-notifier')
const meow = require('meow')

const log = debug('gen-readme:log')
const cli = meow(`
	Usage
		$ gen-readme

	Options
		--travis       Force enable Travis CI Badge
		--xo           Force enable XO Badge
		--write, -w    Output README.md file

	Examples
		$ gen-readme package.json > README.md
		$ gen-readme package.json --travis --xo
		$ gen-readme package.json --write
`, {
	booleanDefault: false,
	flags: {
		travis: {
			type: 'boolean'
		},
		xo: {
			type: 'boolean'
		},
		write: {
			type: 'boolean',
			alias: 'w'
		}
	}
})
updateNotifier({pkg: cli.pkg}).notify()

const beautifulName = name => {
	return name
		.replace(/^./, name[0].toUpperCase())
		.replace(/-/g, ' ')
}

const showTextIf = (v, text) => {
	if (v && v.length != 0) {
		return text
	}

	return ''
}

const usageShow = (content, type) => {
	if (type == 'url') {
		return `- [${content.replace(/htt[ps]*:\/\//i, '')}](${content})`
	}

	return content
}

const usageShowCode = (type, text) => {
	if (type == 'url') {
		return ''
	}

	return text
}

const removeSpace = str => str.replace(/(\s*)$/g, '')

const removeNewLine = str => str.replace(/\n[\n]*\n/gs, '\n\n')

const cleanCode = str => removeSpace(removeNewLine(str))

const getExtension = file => file.split('.').pop()

const addExtensions = (files, extensions) => {
	const fileWithExtensions = []

	extensions.forEach(ext => {
		files.forEach(file => {
			fileWithExtensions.push(`${file}.${ext}`)
		})
	})

	return fileWithExtensions
}

const checkFiles = async data => {
	const documentation = await findUp(addExtensions(['docs', 'documentation', 'doc', 'usage'], ['md']))
	const example = await findUp(addExtensions(['example'], ['js', 'sh', 'md', 'vue', 'ts']))
	const usage = await findUp(addExtensions(['usage'], ['sh', 'bash']))

	if (documentation) {
		data.documentation = documentation
	}

	if (example) {
		data.example = {
			language: getExtension(example),
			content: cleanCode(fs.readFileSync(example).toString())
		}

		data.example.content = data.example.content.replace(
			/require\((['"])?\.[/]*['"]?\)/,
			`require($1${data.name}$1)`
		)
	}

	if (usage) {
		data.usage = {
			language: getExtension(usage),
			content: cleanCode(fs.readFileSync(usage).toString())
		}
	}

	return data
}

const checkLicense = data => {
	data.license = {
		type: data.license
	}
	if (data.license.type.toLocaleLowerCase() === 'mit') {
		if (data.author.name && data.author.url) {
			data.license.authorWithUrl = `© [${data.author.name}](${data.author.url})`
		} else {
			data.license.authorWithUrl = `© ${(data.author.name || data.author)}`
		}
	} else {
		data.license.authorWithUrl = ''
	}

	return data
}

const checkDocumentation = data => {
	if (data.documentation) {
		if (data.documentation.startsWith('http')) {
			data.documentation = `- [${data.name} developer docs](${data.documentation})`
		} else if (data.documentation.startsWith('./') || data.documentation.startsWith('/')) {
			data.documentation = cleanCode(fs.readFileSync(data.documentation).toString())
		}
	}

	return data
}

const checkTest = data => {
	if (data.scripts.test && data.scripts.test.startsWith('echo')) {
		data.scripts.test = false
	}

	return data
}

const checkBadges = data => {
	const list = []
	if (data.travis) {
		list.push({
			title: 'Travis',
			badge: `https://img.shields.io/travis/${data.gh.user}/${data.gh.repo}.svg?branch=master&style=${data.badges.style}`,
			url: `${data.gh.travis_url}`
		})
	}

	if (data.xo) {
		list.push({
			title: 'XO code style',
			badge: `https://img.shields.io/badge/code%20style-XO-red.svg?style=${data.badges.style}`,
			url: 'https://github.com/xojs/xo'
		})
	}

	if (data.engines && data.engines.node) {
		list.push({
			title: 'Node',
			badge: `https://img.shields.io/node/v/${data.name}.svg?style=${data.badges.style}`,
			url: `https://npmjs.org/package/${data.name}`
		})
	}

	list.push({
		title: 'Version',
		badge: `https://img.shields.io/npm/v/${data.name}.svg?style=${data.badges.style}`,
		url: `https://npmjs.org/package/${data.name}`
	})
	list.push({
		title: 'Downloads',
		badge: `https://img.shields.io/npm/dt/${data.name}.svg?style=${data.badges.style}`,
		url: `https://npmjs.org/package/${data.name}`
	})

	data.badges.list = [...list, ...data.badges.list]
	// TODO https://img.shields.io/badge/<SUBJECT>-<STATUS>-<COLOR>.svg?style=flat-square
	// TODO if data.twitter return add in badges
	return data
}

const getInfoDeps = deps => {
	return Promise.all(deps.map(async dep => {
		const pkg = await npmPackage(dep).catch(() => {
			return {}
		})
		return {
			...pkg,
			name: dep,
			repository: `https://ghub.io/${dep}`
		}
	}))
}

const main = async () => {
	let data = {
		name: '',
		description: '',
		scripts: {
			test: false
		},
		author: '',
		license: '',
		repository: 'https://github.com/user/repo.git',
		dependencies: {},
		devDependencies: {},
		features: [],
		thanks: [],
		related: [],
		badges: {
			style: 'flat-square',
			list: []
		},
		preferGlobal: false,
		documentation: false,
		travis: false,
		atom: false,
		write: false,
		xo: false,
		engines: {}
	}

	const packageFile = path.resolve(`${process.cwd()}/package.json`)
	const config = path.resolve(`${process.cwd()}/.gen-readme.json`)
	const travis = path.resolve(`${process.cwd()}/.travis.yml`)

	data = merge(
		data,
		JSON.parse(fs.readFileSync(packageFile).toString())
	)

	if (fs.existsSync(config)) {
		data = merge(
			data,
			JSON.parse(fs.readFileSync(config).toString())
		)
	}

	if (fs.existsSync(travis)) {
		data.travis = true
	}

	const devDependenciesKeys = Object.keys(data.devDependencies)
	if (devDependenciesKeys.includes('xo')) {
		data.xo = true
	}

	const enginesKeys = Object.keys(data.engines)
	if (enginesKeys.includes('atom')) {
		data.atom = true
	}

	Object.keys(cli.flags).map(f => {
		if (!cli.flags[f]) {
			delete cli.flags[f]
		}
	})

	data = merge(
		data,
		cli.flags
	)

	data.gh = gh(data.repository.url || data.repository)
	data = await checkFiles(data)
	data = checkLicense(data)
	data = checkDocumentation(data)
	data = checkTest(data)
	data = checkBadges(data)
	data.dependencies = await getInfoDeps(Object.keys(data.dependencies))
	data.devDependencies = await getInfoDeps(Object.keys(data.devDependencies))
	data.related = await getInfoDeps(data.related)

	log('data', data)

	handlebars.registerHelper('showTextIf', showTextIf)
	handlebars.registerHelper('beautiful', beautifulName)
	handlebars.registerHelper('usageShow', usageShow)
	handlebars.registerHelper('usageShowCode', usageShowCode)

	const template = fs.readFileSync(path.join(__dirname, 'template.md')).toString()
	let readme = handlebars.compile(template)(data)
	readme = cleanCode(removeNewLine(readme))

	log('readme', readme)

	if (data.write) {
		fs.writeFileSync('README.md', readme)
	}

	process.stdout.write(readme)
}

main().catch(async error => {
	log('error', error)
	console.error(error)
	await new Promise(resolve => setTimeout(
		resolve,
		(3000)
	))
	return process.exit()
})
