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
const globalChangeListeners = {};

let renderOffset = -1;
let renderComposableOffset = -1;
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
	renderComposableOffset++;
	composableStateIndex = 0;
	composableEffectIndex = 0;

	if (Array.isArray(target)) {
		return Promise.all(target.map(c => composeToDOM(c)));
	}

	if (typeof target === "string" || typeof target === "number") {
		return target;
	}

	if (target.__c) {
		let curHash = renderState.hash[renderComposableOffset];
		let newHash = hash([ target, renderComposableOffset ]);

		// If nothing has changed, return the same thing we returned before
		if (curHash === newHash) {
			const cached = renderState.rendered[renderComposableOffset];
			if (cached) {
				return cached;
			}
		}

		// Update the hash
		renderState.hash[renderComposableOffset] = newHash;

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
			console.log("Attempted to compose unsupported object", target.target);
		}

		renderState.rendered[renderComposableOffset] = result;

		return result;
	}
}

async function render(composable, target) {
	if (!target || !target.id) {
		console.error("Invalid target. Target must be a DOM element with an ID.", target);
		return;
	}

	renderTarget = target.id;

	if (!globalRenderState.hasOwnProperty(renderTarget)) {
		globalRenderState[renderTarget] = {
			state: [],
			effects: [],
			hash: [],
			rendered: []
		};
	}

	renderTarget = target.id;
	renderState = globalRenderState[renderTarget];
	renderComposableOffset = -1;

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
	renderState.effects.forEach(({ mount = [], unmount = [] }, key) => {
		mount.forEach(fn => {
			if (typeof fn === "function") {
				unmount.push(fn());
			}
		});
	});

	// Handle re-renders
	renderEmitter.on(`rerender:${renderTarget}`, () => {
		render(composable, target);
	})

	// Wait for mount promises (so we can get the unmount back)
	for (let ei in renderState.effects) {
		for (let mi in renderState.effects[ei].unmount) {
			renderState.effects[ei].unmount[mi] = await renderState.effects[ei].unmount[mi];
		}
	}
}

function useEffect(fn) {
	composableEffectIndex++;
	if (!renderState.effects[renderComposableOffset]) {
		renderState.effects[renderComposableOffset] = { mount: [], unmount: [] };
	} 

	const oldSig = (renderState.effects[renderComposableOffset].mount[composableEffectIndex] || "").toString();
	const fnSig = fn.toString();

	// Only expose this mount method if we haven't already executed it
	renderState.effects[renderComposableOffset].mount[composableEffectIndex] = (
		oldSig !== fnSig
	) ? fn : null;
}

function useState(defaultValue = null) {
	composableStateIndex++;

	const rco = renderComposableOffset + 0;
	const csi = composableStateIndex + 0;

	if (!Array.isArray(renderState.state[rco])) {
		renderState.state[rco] = [];
	}

	if (!renderState.state[rco][csi]) {
		renderState.state[rco][csi] = defaultValue;
	}


	return [cloneDeep(renderState.state[rco][csi]), (newVal) => {
		// Update the state value
		if (typeof newVal === "object" && typeof globalState[rco][csi] === "object") {
			renderState.state[rco][csi] = {
				...renderState.state[rco][csi],
				...newVal
			};
		} else {
			renderState.state[rco][csi] = newVal;
		}

		// Trigger re-render
		renderEmitter.emit(`rerender:${renderTarget}`);
	}];
}

module.exports = {
	appendTo,
	cloneDeep,
	composable,
	composeToDOM,
	render,
	useEffect,
	useState
};