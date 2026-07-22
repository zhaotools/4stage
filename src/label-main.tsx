import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import LabelApp from "./LabelApp";

createRoot(document.getElementById("root")!).render(<StrictMode><LabelApp /></StrictMode>);
