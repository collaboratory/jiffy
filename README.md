# @collaboratory/jiffy
Fully composable JSX toolkit supporting both synchronous and asynchronous components.

Configure JSX pragma to use `composable`.

### .babelrc
```
{
	"presets": ["@babel/env"],
	"plugins": ["@babel/transform-runtime", ["transform-react-jsx", { "pragma": "composable" }]]
}
```

### Pragma
```
/* @jsx composable */
```

### Example
Documentation coming soon. For now, gather what you can from this example:
```js
import http from "axios";
import { composable, renderDOM, renderString, useState, useEffect } from "@collaboratory/jiffy";

function Button({ children, ...props }) {
	const { color, ...attributes } = props;
	return <button {...attributes} >{children}</button>;
}

async function AsyncComponent() {
	const data = await http.get("http://api.coindesk.com/v1/bpi/historical/close.json").then(({data}) => data);
	const total = Object.values(data.bpi).reduce((a, b) => a + b);
	const avg = total / Object.keys(data.bpi).length;

	return <div>Total: {total}, Average: {avg}</div>;
}

function SyncComponent() {
	const [bpi, setBPI] = useState(null);

	useEffect(() => {
		setTimeout(() => {
			console.log('Setting BPI');
			setBPI(42);
		}, 3000);
	}, () => {
		console.log('Sync component unounted', bpi)
	});

	return bpi === 42 ? <div>42!</div> : <div>Synchronous render component</div>;
}

function onButtonClick(e) {
	console.log('Button clicked', e);
}

const App = ({ title = "App A" }) => (
	<null>
		<h1>{title}</h1>
		<Button onClick={onButtonClick} color="green">Click Me</Button>
		<AsyncComponent />
		<SyncComponent />
	</null>
);

window.onload = () => {
	// Async render to string with optional support for re-render callback
	const rootC = document.getElementById("rootC");
	renderString(<App title="App C"/>, { onReRender: asString => {
		rootC.innerHTML = asString;
	} }).then(asString => {
		rootC.innerHTML = asString;
	});

	// All of these renders are async in nature but only one can execute at a time (for now).
	renderDOM(<App title="App A" />, document.getElementById("root"));
	renderDOM(<App title="App B" />, document.getElementById("rootB"));
};
```