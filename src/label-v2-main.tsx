import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import LabelV2App from "./LabelV2App";

createRoot(document.getElementById("root")!).render(<StrictMode><LabelV2App /></StrictMode>);
