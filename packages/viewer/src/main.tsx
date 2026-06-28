import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import { DEMO_REVIEW } from "./review/demo.ts";
import { ReviewPage } from "./review/ReviewPage.tsx";
import { ReviewView } from "./review/ReviewView.tsx";
import "./index.css";
import "./styles.css";

// The review form factor (docs/review-form-factor.md) renders full-page:
//   ?review-preview      → the layout with demo data (isolated styling)
//   ?review=<sessionId>  → a real stored review fetched from the server
// otherwise the normal board app.
const params = new URLSearchParams(location.search);
const reviewSession = params.get("review");
const root = createRoot(document.body);
if (params.has("review-preview")) root.render(<ReviewView review={DEMO_REVIEW} />);
else if (reviewSession) root.render(<ReviewPage sessionId={reviewSession} />);
else root.render(<App />);
