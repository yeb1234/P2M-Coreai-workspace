import { AppLayout } from './components/layout';
import { useCrossModuleSync } from './hooks';
import { registerAllPlugins } from './plugins';

registerAllPlugins();

function App() {
  useCrossModuleSync();

  return <AppLayout />;
}

export default App;
