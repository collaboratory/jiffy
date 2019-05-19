import hash from "object-hash";
import emitter from "@emitterware/emitter";

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

function composable(target, props, ...children) {
	return { target, props: { ...props, children }, __c: true };
}

async function composeToDOM(target) {
	renderComposeOffset++;
	composableStateIndex = 0;
	composableEffectIndex = 0;

	if (Array.isArray(target)) {
		return Promise.all(target.map(c => composeToDOM(c)));
	}

	if (typeof target === "string" || typeof target === "number") {
		return target;
	}

	if (target && target.__c) {
		let curHash = renderState.hash[renderComposeOffset];
		let newHash = hash([ target, renderComposeOffset ]);

		// If nothing has changed, return the same thing we returned before
		if (curHash === newHash) {
			const cached = renderState.rendered[renderComposeOffset];
			if (cached) {
				return cached;
			}
		}

		// Update the hash
		renderState.hash[renderComposeOffset] = newHash;

		const { children, ...props } = target.props;

		// Compose children first
		const content = await composeToDOM(children);

		// curState and curEffects should now be updated (if applicable)
		let result = null;
		if (typeof target.target === "string") {
			// We need to make a DOM element
			if (target.target === "null") {
				result = content;
			} else {
				const element = document.createElement(target.target);
				const propKeys = Object.keys(props);

				// Event handlers
				propKeys.filter(key => eventHandlerMap[key]).forEach(key => {
					element.addEventListener(eventHandlerMap[key], props[key]);
				});

				// Other props
				propKeys.filter(key => !eventHandlerMap[key]).forEach(key => {
					element.setAttribute(key, props[key]);
				});

				appendTo(element, content);
				result = element;
			}
		} else if (typeof target.target === "function") {
			// We need to call the function and see what comes out
			const r = await target.target(target.props);
			result = await composeToDOM(r);
		} else if (typeof target.target === "object") {
			// We don't support objects/classes yet
			console.warn("Attempted to compose unsupported object", target.target);
		}

		renderState.rendered[renderComposeOffset] = result;

		return result;
	} else {
		console.error("Invalid composition target", target);
		if (typeof target === "function") {
			console.warn("The above error references a function, perhaps you attempted to render a component instead of a jsx tag.");
		}
	}
}

let isRendering = false;
async function render(composable, target) {
	if (!target || !target.id) {
		console.error("Invalid target. Target must be a DOM element with an ID.", target);
		return;
	}

	while (isRendering) {
		await new Promise(resolve => setTimeout(resolve, 1));
	}

	isRendering = true;
	renderTarget = target.id;

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

		// Handle re-renders
		globalRenderState[renderTarget].listener = renderEmitter.on(`rerender:${renderTarget}`, ((composable, target, renderTarget) => {
			return async () => {
				await render(composable, target);
			};
		})(composable, target, renderTarget));
	}

	renderState = globalRenderState[renderTarget];

	if (renderState.inProgress) {
		return;
	}

	renderState.inProgress = true;
	renderComposeOffset = -1;

	// Render mounted
	renderState.effects.forEach(effect => {
		effect.mount = [];
	});

	const composed = await composeToDOM(composable);

	target.innerHTML = '';
	if (Array.isArray(composed)) {
		composed.forEach(c => {
			target.appendChild(c);
		});
	} else {
		target.appendChild(composed);
	}

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
	return;
}

async function composeToString(target) {
	renderComposeOffset++;
	composableStateIndex = 0;
	composableEffectIndex = 0;

	if (Array.isArray(target)) {
		return Promise.all(target.map(c => composeToString(c)));
	}

	if (typeof target === "string" || typeof target === "number") {
		return target;
	}

	if (target && target.__c) {
		const { children, ...props } = target.props;

		// Compose children first
		const content = await composeToString(children);

		// curState and curEffects should now be updated (if applicable)
		let result = null;
		if (typeof target.target === "string") {
			// We need to make a DOM element
			if (target.target === "null") {
				result = content;
			} else {
				// Actually render a raw tag to string
				result = `<${target.target} ${
					Object.keys(props)
						.filter(key => !eventHandlerMap[key])
						.map(key => `${key}=${props[key]}`)
						.join(' ')
				}>${Array.isArray(content) ? content.join("") : content}</${target.target}>`;
			}
		} else if (typeof target.target === "function") {
			// We need to call the function and see what comes out
			const r = await target.target(target.props);
			result = await composeToString(r);
		} else if (typeof target.target === "object") {
			// We don't support objects/classes yet
			console.warn("Attempted to compose unsupported object", target.target);
		}

		return result;
	} else {
		console.error("Invalid composition target", target);
	}
}

let stringRenderID = -1;
async function renderToString(composable, { onReRender = false, prevTarget = null } = {}) {
	// Wait in line
	while (isRendering) {
		await new Promise(resolve => setTimeout(resolve, 1));
	}


	if (!prevTarget) {
		stringRenderID++;
		renderTarget = `__sr_${stringRenderID}`;
	} else {
		renderTarget = `${prevTarget}`;
	}

	isRendering = true;

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

		// Handle re-renders
		if (onReRender) {
			globalRenderState[renderTarget].listener = renderEmitter.on(`rerender:${renderTarget}`, ((composable, onReRender, renderTarget) => {
				return async () => {
					await renderToString(composable, { prevTarget: renderTarget }).then(onReRender);
				};
			})(composable, onReRender, renderTarget));
		}
	}

	renderState = globalRenderState[renderTarget];

	if (renderState.inProgress) {
		return;
	}

	renderState.inProgress = true;
	renderComposeOffset = -1;

	// Render mounted
	renderState.effects.forEach(effect => {
		effect.mount = [];
	});

	const composed = await composeToString(composable);
	const response = `${Array.isArray(composed) ? composed.join("\n") : composed}`;

	// Trigger pending mount effects
	await Promise.all(renderState.effects.map(async ({ mount = [], unmount = [] }, key) => {
		return await Promise.all(mount.map(async fn => {
			if (typeof fn === "function") {
				unmount.push(await fn());
			}
		}));
	}));

	// Render mounted
	renderState.effects.forEach(effect => {
		effect.mount = [];
	});

	renderState.inProgress = false;
	isRendering = false;


	return response;
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
	composeToDOM,
	composeToString,
	render,
	renderToString,
	useEffect,
	useState
};