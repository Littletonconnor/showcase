import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import { DEMO_REVIEW } from "./review/demo.ts";
import { ReviewView } from "./review/ReviewView.tsx";
import "./index.css";
import "./styles.css";

// `?review-preview` renders the agent-era review form factor with demo data, so
// the layout can be iterated on in isolation before it's wired to publish/sessions.
const preview = new URLSearchParams(location.search).has("review-preview");
createRoot(document.body).render(preview ? <ReviewView review={DEMO_REVIEW} /> : <App />);
