import { useNavigate } from "react-router-dom";

// FIXTURE: a stand-in for a real sign-in page.
//
// "Signing in" here just sets a flag in localStorage, which is exactly the kind of
// state Playwright's storageState captures — so this exercises the real mechanism
// `vibeguru auth` relies on, without needing a backend or real credentials.
export default function Login() {
  const navigate = useNavigate();

  const signIn = () => {
    localStorage.setItem("vg_session", "ok");
    navigate("/protected");
  };

  return (
    <section>
      <h2>Sign in</h2>
      <p>This app's protected pages are unreachable until you sign in.</p>
      <button onClick={signIn}>Sign in</button>
    </section>
  );
}
