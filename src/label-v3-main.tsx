import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import LabelV2App from "./LabelV2App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <LabelV2App
      candidateUrl="./data/stage13-validation-v3-candidates.json"
      storageKey="stage13-structured-validation-v3"
      title="Stage 1 / Stage 3 · 第三轮盲测"
      exportPrefix="stage13-structured-validation-v3"
    />
  </StrictMode>,
);
