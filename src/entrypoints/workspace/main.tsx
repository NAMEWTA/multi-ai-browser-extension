import React from "react";
import ReactDOM from "react-dom/client";
import { WorkspaceApp } from "./workspace-app";
import "./workspace.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <WorkspaceApp />
  </React.StrictMode>,
);
