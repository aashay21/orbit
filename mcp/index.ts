// Orbit MCP server: lets Claude Code read and update the board. Speaks MCP over stdio and
// forwards everything to the Orbit HTTP API (ORBIT_URL, default http://127.0.0.1:4700).
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { INSTRUCTIONS, registerTools } from "./tools.ts";

const server = new McpServer({ name: "orbit", version: "0.2.0" }, { instructions: INSTRUCTIONS });
registerTools(server);
await server.connect(new StdioServerTransport());
