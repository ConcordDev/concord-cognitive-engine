// Jest auto-mock for react-native-webview.
//
// The real module calls TurboModuleRegistry.getEnforcing('RNCWebViewModule')
// at import time, which throws under Jest (no native binary). This manual
// mock — placed in <rootDir>/__mocks__ adjacent to node_modules — is picked
// up automatically by Jest for every `import 'react-native-webview'`, so
// screens that wrap a WebView remain importable + renderable in tests.
const React = require('react');

const WebView = React.forwardRef(function WebView(props, ref) {
  // Render nothing native — just a passthrough host element. Tests assert
  // on the component's existence/type, not on real WebView behavior.
  return React.createElement('WebView', { ...props, ref });
});

module.exports = {
  __esModule: true,
  WebView,
  default: WebView,
};
