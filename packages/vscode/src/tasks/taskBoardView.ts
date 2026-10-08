import type { TaskStatus } from "@earendil-works/pi-core";
import * as vscode from "vscode";
import { getNpcRuntimeHost } from "../runtime/runtimeHost";

const statuses: TaskStatus[] = ["backlog", "todo", "in_progress", "review", "done", "blocked"];

function makeNonce(): string {
	return Buffer.from(String(Date.now()) + Math.random())
		.toString("base64")
		.replace(/[^a-zA-Z0-9]/g, "")
		.slice(0, 24);
}

export class PiTaskBoardViewProvider implements vscode.WebviewViewProvider {
	public static readonly viewType = "pi-task-board";
	private view?: vscode.WebviewView;

	resolveWebviewView(webviewView: vscode.WebviewView): void {
		this.view = webviewView;
		webviewView.webview.options = { enableScripts: true };
		webviewView.webview.html = this.html();
		webviewView.webview.onDidReceiveMessage(async (message: Record<string, unknown>) => {
			try {
				const host = await getNpcRuntimeHost();
				switch (message.command) {
					case "ready":
					case "refresh":
						await this.refresh();
						break;
					case "createTask":
						host.createTask({
							title: String(message.title ?? ""),
							description: typeof message.description === "string" ? message.description : undefined,
							priority: message.priority === "low" || message.priority === "high" ? message.priority : "medium",
						});
						await this.refresh();
						break;
					case "updateTask":
						if (typeof message.id === "string" && typeof message.status === "string") {
							host.updateTask(message.id, { status: message.status as TaskStatus });
							await this.refresh();
						}
						break;
					case "deleteTask":
						if (typeof message.id === "string") {
							host.removeTask(message.id);
							await this.refresh();
						}
						break;
					case "openChat":
						await vscode.commands.executeCommand("pi.openChat");
						break;
				}
			} catch (error) {
				this.post({ type: "error", message: error instanceof Error ? error.message : String(error) });
			}
		});
	}

	refresh(): void {
		void this.sendTasks();
	}

	private async sendTasks(): Promise<void> {
		const host = await getNpcRuntimeHost();
		this.post({ type: "tasks", tasks: host.getTasks() });
	}

	private post(message: Record<string, unknown>): void {
		void this.view?.webview.postMessage(message);
	}

	private html(): string {
		const nonce = makeNonce();
		const statusJson = JSON.stringify(statuses);
		const html = [
			"<!doctype html>",
			"<html><head><meta charset='UTF-8'>",
			"<meta http-equiv='Content-Security-Policy' content=\"default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-" +
				nonce +
				"';\">",
			"<meta name='viewport' content='width=device-width, initial-scale=1'>",
			"<style>",
			":root{color-scheme:light dark;--b:var(--vscode-widget-border,var(--vscode-panel-border));--m:var(--vscode-descriptionForeground);--a:var(--vscode-textLink-foreground,var(--vscode-focusBorder));--c:var(--vscode-editor-background);--h:var(--vscode-list-hoverBackground)}",
			"*{box-sizing:border-box}body{margin:0;padding:10px;color:var(--vscode-foreground);background:var(--vscode-sideBar-background);font:12px var(--vscode-font-family)}",
			"header,.toolbar,.actions,.new-row{display:flex;gap:6px;align-items:center}header{justify-content:space-between;margin-bottom:10px}h2{margin:0;font-size:13px}",
			"button,input,textarea,select{font:inherit;color:inherit;background:var(--vscode-input-background);border:1px solid var(--b);border-radius:5px}button{padding:5px 8px;cursor:pointer}button:hover{background:var(--h)}",
			"button.active{border-color:var(--a)}.toolbar{margin-bottom:8px}.new-task{padding:8px;border:1px solid var(--b);border-radius:6px;margin-bottom:10px;background:var(--c)}",
			"input,textarea{width:100%;padding:6px;margin-bottom:6px}textarea{min-height:44px;resize:vertical}.new-row select{width:90px;padding:5px}.new-row button{flex:1}",
			".list{display:flex;flex-direction:column;gap:6px}.board{display:grid;grid-template-columns:repeat(4,minmax(130px,1fr));gap:6px;overflow:auto}",
			".col{min-width:130px;border:1px solid var(--b);border-radius:6px;padding:6px}.col h3{margin:0 0 6px;font-size:10px;color:var(--m);text-transform:uppercase}",
			".card{padding:7px;border:1px solid var(--b);border-radius:6px;background:var(--c)}.card+.card{margin-top:5px}.title{font-weight:600}.meta{color:var(--m);font-size:10px;margin-top:3px;display:flex;justify-content:space-between}.desc{color:var(--m);white-space:pre-wrap;margin:5px 0;line-height:1.35}.card select{width:100%;margin-top:6px;padding:4px}.empty{color:var(--m);padding:10px;text-align:center}",
			"</style></head><body>",
			"<header><h2>NPC Tasks</h2><div class='actions'><button id='chat'>Chat</button><button id='refresh'>Refresh</button></div></header>",
			"<div class='toolbar'><button id='listMode' class='active'>List</button><button id='boardMode'>Kanban</button></div>",
			"<section class='new-task'><input id='title' placeholder='New task title'><textarea id='description' placeholder='Description / acceptance criteria'></textarea>",
			"<div class='new-row'><select id='priority'><option value='low'>Low</option><option value='medium' selected>Medium</option><option value='high'>High</option></select><button id='add'>Add task</button></div></section>",
			"<div id='error'></div><div id='content'></div>",
			"<script nonce='" + nonce + "'>",
			"const vscode=acquireVsCodeApi();const statuses=" + statusJson + ";let tasks=[];let mode='list';",
			"const esc=v=>String(v??'').replace(/[&<>\"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',\"'\":'&#39;'}[c]));",
			"const label=s=>s.replaceAll('_',' ').replace(/\\b\\w/g,c=>c.toUpperCase());",
			"function card(t){const opts=statuses.map(s=>'<option value=\"'+s+'\" '+(s===t.status?'selected':'')+'>'+label(s)+'</option>').join('');return '<article class=\"card\"><div class=\"title\">'+esc(t.title)+'</div><div class=\"meta\"><span>'+esc(t.priority)+'</span><span>'+(t.assignee?esc(t.assignee):'unassigned')+'</span></div>'+(t.description?'<div class=\"desc\">'+esc(t.description)+'</div>':'')+'<select data-id=\"'+esc(t.id)+'\">'+opts+'</select><button data-delete=\"'+esc(t.id)+'\" style=\"margin-top:5px\">Delete</button></article>';}",
			"function render(){const root=document.getElementById('content');if(!tasks.length){root.innerHTML='<div class=\"empty\">No tasks yet. Create one above or ask the agent to create tasks.</div>';return;}if(mode==='list'){root.innerHTML='<div class=\"list\">'+tasks.map(card).join('')+'</div>';return;}const cols=['todo','in_progress','review','done'];root.innerHTML='<div class=\"board\">'+cols.map(s=>'<section class=\"col\"><h3>'+label(s)+' ('+tasks.filter(t=>t.status===s).length+')</h3>'+(tasks.filter(t=>t.status===s).map(card).join('')||'<div class=\"empty\">—</div>')+'</section>').join('')+'</div>';}",
			"document.getElementById('listMode').onclick=()=>{mode='list';document.getElementById('listMode').classList.add('active');document.getElementById('boardMode').classList.remove('active');render();};",
			"document.getElementById('boardMode').onclick=()=>{mode='board';document.getElementById('boardMode').classList.add('active');document.getElementById('listMode').classList.remove('active');render();};",
			"document.getElementById('refresh').onclick=()=>vscode.postMessage({command:'refresh'});document.getElementById('chat').onclick=()=>vscode.postMessage({command:'openChat'});",
			"document.getElementById('add').onclick=()=>{const title=document.getElementById('title').value.trim();if(!title)return;vscode.postMessage({command:'createTask',title,description:document.getElementById('description').value,priority:document.getElementById('priority').value});document.getElementById('title').value='';document.getElementById('description').value='';};",
			"document.getElementById('content').addEventListener('change',e=>{if(e.target.matches('select[data-id]'))vscode.postMessage({command:'updateTask',id:e.target.dataset.id,status:e.target.value});});",
			"document.getElementById('content').addEventListener('click',e=>{if(e.target.matches('button[data-delete]'))vscode.postMessage({command:'deleteTask',id:e.target.dataset.delete});});",
			"window.addEventListener('message',e=>{const m=e.data;if(m.type==='tasks'){tasks=Array.isArray(m.tasks)?m.tasks:[];render();}if(m.type==='error'){document.getElementById('error').textContent=m.message;}});vscode.postMessage({command:'ready'});",
			"</script></body></html>",
		].join("\n");
		return html;
	}
}
