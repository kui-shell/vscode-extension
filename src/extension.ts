// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';

import * as path from 'path';

process.env.KUI_HEADLESS = 'true';
process.env.KUI_REPL_MODE = 'true';

import { main as KuiMain } from '@kui-shell/core';
import { setValidCredentials } from '@kui-shell/core/core/capabilities';

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log('Activating the Kui extension');

	// The command has been defined in the package.json file
	// Now provide the implementation of the command with registerCommand
	// The commandId parameter must match the command field in package.json
	let disposable = vscode.commands.registerCommand('extension.kui', () => {
		// The code you place here will be executed every time your command is executed

		// Display a message box to the user
		// vscode.window.showInformationMessage('Hello World!');
		KuiPanel.createOrShow(context.extensionPath);
	});

	context.subscriptions.push(disposable);
}

class KuiPanel {
	/**
	 * Track the currently panel. Only allow a single panel to exist at a time.
	 */
	public static currentPanel: KuiPanel | undefined;

	public static readonly viewType = 'kui';
	
	private readonly _panel: vscode.WebviewPanel;
	private readonly _extensionPath: string;
	private _disposables: vscode.Disposable[] = [];	
	
	public static createOrShow(extensionPath: string) {
		const column = vscode.window.activeTextEditor
			? vscode.window.activeTextEditor.viewColumn
			: undefined;

		// If we already have a panel, show it.
		if (KuiPanel.currentPanel) {
			KuiPanel.currentPanel._panel.reveal(column);
			return;
		}


		// Otherwise, create a new panel.
		const panel = vscode.window.createWebviewPanel(
			KuiPanel.viewType,
			'Kui Shell',
			column || vscode.ViewColumn.One,
			{
				// Enable javascript in the webview
				enableScripts: true,

				// And restrict the webview to only loading content from our extension's `dist/webpack` directory.
				localResourceRoots: [
					vscode.Uri.file(path.join(extensionPath, 'dist/webpack'))
				]
			}
		);

		KuiPanel.currentPanel = new KuiPanel(panel, extensionPath);
	}
	
	public dispose() {
		KuiPanel.currentPanel = undefined;

		// Clean up our resources
		this._panel.dispose();

		while (this._disposables.length) {
			const x = this._disposables.pop();
			if (x) {
				x.dispose();
			}
		}
	}

	private _update() {
		this._panel.webview.html = this._getHtmlForWebview();
	}
	
	private _getHtmlForWebview() {
		const media = path.join(this._extensionPath, 'dist/webpack');
		const mediaUri = vscode.Uri.file(media).with({ scheme: 'vscode-resource' });
		
		// Use a nonce to whitelist which scripts can be run
		const nonce = getNonce();

		const html = require('fs').readFileSync(path.join(media, 'index.html'))
			.toString()
			.replace('<head>', `<head>
			<meta http-equiv="Content-Security-Policy" content="default-src 'nonce-${nonce}' vscode-resource: https:; style-src 'unsafe-inline' vscode-resource: https:; img-src vscode-resource: data: https:; script-src 'nonce-${nonce}' 'unsafe-eval' 'unsafe-inline' vscode-resource: https:">
			<style>body { padding: 0 !important; }</style>
			<script nonce="${nonce}">
			console.log('Setting up kui');
			const vscode = acquireVsCodeApi();

			console.log('previous state?', vscode.getState());
			if (!vscode.getState()) {
				vscode.setState({});
			}

			let cbCount = 1;
			const callbacks = {};
			window.addEventListener('message', (event) => {
				console.log('message', event)
				const message = event.data
				
				if (message && message.cbCount) {
					console.log('callback', message);
					const cb = callbacks[message.cbCount];
					delete callbacks[message.cbCount];
					delete message.cbCount
					cb(message)
				} else {
					console.error('unknown event', message)
				}
			});
			
			window['webview-proxy'] = body => new Promise(resolve => {
				callbacks[cbCount] = resolve;
				vscode.postMessage(Object.assign({}, body, { cbCount }));
				cbCount++
			})
			
			console.log('so good', vscode);
			window.mediaUri = "${mediaUri}";
			window.kuiLocalStorage = {
				getItem: key => {
					// this needs to default to null; JSON.parse does not like undefined
					return vscode.getState()[key] || null;
				},
				setItem: (key, value) => {
					const state = vscode.getState();
					state[key] = value;

					console.log('saving state', state)
					vscode.setState(state);
				},
				removeItem: (key) => {
					const state = vscode.getState();
					delete state[key];
					vscode.setState(state);
				},
				clear: () => {
					vscode.setState();
				}
			}
			console.log('all done', window.kuiLocalStorage);
			</script>
			`)
			.replace(/link href="(ui|left-tab-stripe|not-electron).css"/g, `link nonce="${nonce}" href="${mediaUri}/$1.css"`)
			.replace(/script (.*) src="https:/g, `script nonce="${nonce}" $1 src="https:`)
			.replace(/link (.*) href="https:/g, `link nonce="${nonce}" $1 href="https:`)
			.replace(/script src="main\./, `script nonce="${nonce}" src="${mediaUri}/main.`)
			.replace(/image:url\('(.*)'\)/g, `image:url('${mediaUri}/$1')`);
		// console.log(html);

		return html;
	}
	
	private constructor(panel: vscode.WebviewPanel, extensionPath: string) {
		this._panel = panel;
		this._extensionPath = extensionPath;

		// Set the webview's initial html content
		this._update();

		// Listen for when the panel is disposed
		// This happens when the user closes the panel or when the panel is closed programatically
		this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

		// Update the content based on view changes
		this._panel.onDidChangeViewState(
			e => {
				if (this._panel.visible) {
					this._update();
				}
			},
			null,
			this._disposables
		);

		// Handle messages from the webview
		this._panel.webview.onDidReceiveMessage(
			message => {
				if (message.cbCount) {
					this.kuiExec(message);
				}
			},
			null,
			this._disposables
		);
	}
	
	async kuiExec({ command, execOptions, cbCount}: { command: string, execOptions: any, cbCount: number }) {
		console.log('kuiExec', command, cbCount, KuiMain);

		const webview = this._panel.webview;
		
		try {
			// so that our catch (err) below is used upon command execution failure
			execOptions.rethrowErrors = true;
  
			if (execOptions && execOptions.credentials) {
		  		// FIXME this should not be a global
		  		setValidCredentials(execOptions.credentials);
			}
  
			const body = await KuiMain([ '', ...command.split(' ') ], process.env, execOptions);
			console.log('kuiExec response', body);

			if (typeof body === 'string') {
				webview.postMessage({ statusCode: 200, body, cbCount });
			} else {
				const statusCode = body.code || body.statusCode || 200;
				webview.postMessage({ statusCode, body, cbCount });
			}
	  	} catch (err) {
			console.error('exception in command execution', err.code, err.message, err);
			const statusCode = err.code || err.statusCode || 500;
			webview.postMessage({ statusCode, body: err.message || err, cbCount });
	  	}
  }	
}

function getNonce() {
	let text = '';
	const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	for (let i = 0; i < 32; i++) {
		text += possible.charAt(Math.floor(Math.random() * possible.length));
	}
	return text;
}

// this method is called when your extension is deactivated
export function deactivate() {}
