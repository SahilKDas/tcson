# TcSON

TcSON evaluates a constrained, synchronous TypeScript configuration language
and returns deterministic JSON. It is an independent clean-room implementation
of the behavior specified by the Team A handoff documents in the parent
workspace.

```ts
import { eval, unmarshal } from "tcson";

const bytes = eval("config.tson");
const value = unmarshal("config.tson");
```

```console
tcson eval config.tson
```

Only relative `.tson` default imports are supported. Configuration execution
does not receive Node.js globals, filesystem access, network access, or package
loading.
