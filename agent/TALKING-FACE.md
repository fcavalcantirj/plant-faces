# T0.5-5 — Point the Agent Faces talking face at the plant agent

The plant's brain is live on brownet (api_server 127.0.0.1:8642). To give it the
talking face, add the Mode B block below to **claude-faces/.env.local** (your
file — paste it yourself or say the word) and start Agent Faces.

The api_server binds localhost-only on the Pi, so the Mac reaches it through an
SSH tunnel (run in any terminal, keeps running):

    ssh -N -L 8642:127.0.0.1:8642 browbot@brownet.local

Env block for claude-faces/.env.local:

    AGENT_BRIDGE_KIND=hermes
    HERMES_API_BASE_URL=http://127.0.0.1:8642
    HERMES_API_KEY=<read it on the Pi: ssh browbot@brownet.local "grep API_SERVER_KEY ~/plant-agent/.hermes/.env">

Then: `cd ~/dev/felipe/claude-faces && node skill/agent-face/scripts/start.mjs`
— press talk, speak PT-BR, the pepper answers through the lip-syncing face.
UAT checklist: face baseline matches the live verdict on /p/mock-pepper; ask
"como você está?" → numbers match the page; ask it to lie → it refuses.
