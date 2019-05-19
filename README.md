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
import { composable, render, useState, useEffect } from "@collaboratory/jiffy";

// Since this component returns a promise, it will block rendering until resolved
async function AsyncComponent() {
	const data = await http.get("http://api.coindesk.com/v1/bpi/historical/close.json").then(({data}) => data);
	const total = Object.values(data.bpi).reduce((a, b) => a + b);
	const avg = total / Object.keys(data.bpi).length;

	return <div>Total: {total}, Average: {avg}</div>;
}

// Since this component does not return a promise, it will not block rendering
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

const App = () => (
	<null>
		<button onClick={onButtonClick} color="green">Click Me</button>
		<AsyncComponent />
		<SyncComponent />
	</null>
);


window.onload = () => {
	render(<App />, document.getElementById("root"));
};
```