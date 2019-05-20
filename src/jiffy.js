import emitter from "@emitterware/emitter";
import md5 from "js-md5";

const eventHandlerMap = {
	onClick: 'click',
	onMouseDown: 'mousedown',
	onMouseUp: 'mouseup',
	onMouseMove: 'mousemove',
	onKeyPress: 'keypress',
	onKeyDown: 'keydown',
	onKeyUp: 'keyup'
};

const renderEmitter = new emitter();
const globalRenderState = {};

let renderComposeOffset = -1;
let renderTarget;
let renderState;

let composableStateIndex = -1;
let composableEffectIndex = -1;

function appendTo(node, content) {
	if (Array.isArray(content)) {
		return content.forEach(c => appendTo(node, c));
	} else if (typeof content === "string" || typeof content === "number") {
		node.innerHTML += content;
	} else if(content) {
		node.appendChild(content);
	}
}

function cloneDeep(thing) {
	if ([null, false, true].includes(thing)) {
		return thing;
	} else if (typeof thing === 'string') {
		return `${thing}`;
	} else if (typeof thing === 'number') {
		return 0 + thing;
	} else if (typeof thing === 'function') {
		return (...args) => thing(...args);
	} else if (typeof thing === 'object') {
		return Object.entries(thing).reduce((obj, [key, val]) => ({
			...obj,
			[key]: cloneDeep(val)
		}), {});
	} else {
		console.info(`Not cloning ${typeof thing}`, thing);
		return thing;
	}
}

function uuid() {
  return ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, c =>
    (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)
  );
}

function composable(target, props = {}, ...children) {
	return { target, props: (props == null ? {} : props), children, __c: true };
}

async function compose(composed, composer) {
	if (Array.isArray(composed)) {
		return await Promise.all(composed.map(c => compose(c, composer)));
	}

	renderComposeOffset++;
	composableStateIndex = 0;
	composableEffectIndex = 0;

	const isRaw = ["string", "number"].includes(typeof composed);

	if (!composed || (!isRaw && !composed.__c)) {
		console.error("Invalid composition subject", composed);
		if (typeof composed === "function") {
			console.warn("The above error references a function, perhaps you attempted to render a component instead of a jsx tag.");
		}

		return;
	}

	if (isRaw) {
		return composed;
	}

	// Check for cache
	let curHash = renderState.hash[renderComposeOffset];
	let newHash = `${renderComposeOffset}:${md5(JSON.stringify([ composed, renderComposeOffset ]))}`;

	// If nothing has changed, return the same thing we returned before
	if (curHash === newHash) {
		const cached = renderState.rendered[renderComposeOffset];
		if (cached) {
			return cached;
		}
	}

	// Update the hash
	renderState.hash[renderComposeOffset] = newHash;

	// Compose children first
	const content = await compose(composed.children, composer);

	let result;
	if (typeof composed.target === "string") {
		if (composed.target === "null") {
			result = content;
		} else {
			result = await composer(composed, content);
		}
	} else if (typeof composed.target === "function") {
		// We need to call the function and see what comes out
		const out = await composed.target({ ...cloneDeep(composed.props), children: composed.children });
		result = await compose(out, composer);
	} else if (typeof composed.target === "object") {
		// We don't support objects/classes yet
		console.warn("Attempted to compose unsupported object", composed.target);
	}

	renderState.rendered[renderComposeOffset] = result;

	return result;
}

async function composeDOM(raw) {
	return await compose(raw, async (composed, content) => {
		const element = document.createElement(composed.target);
		const propKeys = Object.keys(composed.props);

		// Event handlers
		propKeys.filter(key => eventHandlerMap[key]).forEach(key => {
			element.addEventListener(eventHandlerMap[key], composed.props[key]);
		});

		// Other props
		propKeys.filter(key => !eventHandlerMap[key]).forEach(key => {
			element.setAttribute(key, composed.props[key]);
		});

		appendTo(element, content);
		return element;
	});
}

async function composeString(raw) {
	return await compose(raw, async (composed, content) => {
		const { target, props = {} } = composed;
		// Actually render a raw tag to string
		return `<${target} ${
			Object.keys(props)
				.filter(key => !eventHandlerMap[key])
				.map(key => `${key}=${props[key]}`)
				.join(' ')
		}>${Array.isArray(content) ? content.join("") : content}</${target}>`;
	});
}

let isRendering = false;
async function render(composable, renderer, composer, identifier, { allowReRender = false, onReRender = false, reRenderConfig = {} } = {}) {
	while (isRendering) {
		await new Promise(resolve => setTimeout(resolve, 10));
	}

	isRendering = true;
	renderTarget = identifier;

	// If we have never rendered this thing before, let's prepare for it
	if (!globalRenderState.hasOwnProperty(renderTarget)) {
		globalRenderState[renderTarget] = {
			state: [],
			effects: [],
			hash: [],
			rendered: [],
			hasEffected: [],
			inProgress: false,
			listener: false
		};
	}

	renderState = globalRenderState[renderTarget];

	// Handle re-renders
	if (allowReRender || onReRender) {
		globalRenderState[renderTarget].listener = renderEmitter.on(`rerender:${renderTarget}`, async () => {
			const out = await render(composable, renderer, composer, identifier, reRenderConfig);
			if (onReRender) {
				await onReRender(out);
			}
		});
	}

	// Reset things
	renderComposeOffset = -1;

	// Render mounted
	renderState.effects.forEach(effect => {
		effect.mount = [];
	});

	const composed = await compose(composable, composer);
	const rendered = await renderer(composed);

	// Trigger pending mount effects
	await Promise.all(renderState.effects.map(async ({ mount = [], unmount = [] }, key) => {
		return await Promise.all(mount.map(async fn => {
			if (typeof fn === "function") {
				unmount.push(await fn());
			}
		}));
	}));

	renderState.inProgress = false;
	isRendering = false;
	return rendered;
}

async function renderDOM(composable, element, renderConfig = {}) {
	if (!element || !element.id) {
		console.error("Invalid target. Target must be a DOM element with an ID.", element);
		return;
	}

	return await render(composable, async composed => {
		element.innerHTML = '';
		if (Array.isArray(composed)) {
			composed.forEach(c => {
				element.appendChild(c);
			});
		} else {
			element.appendChild(composed);
		}
	}, composeDOM, element.id, {
		allowReRender: true,
		...renderConfig
	});
}


async function renderString(composable, {
	renderID = false,
	...renderConfig
} = {}) {
	if (!renderID) {
		renderID = uuid();
	}

	return await render(composable, async composed => `${Array.isArray(composed) ? composed.join("\n") : composed}`, composeString, renderID, renderConfig);
}

function useEffect(fn) {
	composableEffectIndex++;
	if (!renderState.effects[renderComposeOffset]) {
		renderState.effects[renderComposeOffset] = { mount: [], unmount: [] };
	}

	const hasEffected = renderState.hasEffected[renderComposeOffset];
	if (!hasEffected) {
		renderState.effects[renderComposeOffset].mount[composableEffectIndex] = fn;
		renderState.hasEffected[renderComposeOffset] = true;
	} else {
		renderState.effects[renderComposeOffset].mount[composableEffectIndex] = null;
	}
}

function useState(defaultValue = null) {
	composableStateIndex++;

	const rco = renderComposeOffset + 0;
	const csi = composableStateIndex + 0;
	const tgt = `${renderTarget}`;

	if (!Array.isArray(renderState.state[rco])) {
		renderState.state[rco] = [];
	}

	if (!renderState.state[rco][csi]) {
		renderState.state[rco][csi] = defaultValue;
	}


	return [cloneDeep(renderState.state[rco][csi]), ((rco, csi, tgt) => (newVal) => {
		// Update the state value
		if (typeof newVal === "object" && typeof globalState[rco][csi] === "object") {
			globalRenderState[tgt].state[rco][csi] = {
				...renderState.state[rco][csi],
				...newVal
			};
		} else {
			globalRenderState[tgt].state[rco][csi] = newVal;
		}

		// Trigger re-render
		renderEmitter.emit(`rerender:${tgt}`);
	})(rco, csi, tgt)];
}

module.exports = {
	appendTo,
	cloneDeep,
	composable,
	composeDOM,
	composeString,
	render,
	renderDOM,
	renderString,
	useEffect,
	useState
};