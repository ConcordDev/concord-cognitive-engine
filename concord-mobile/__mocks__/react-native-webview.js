// Jest manual mock for react-native-webview.
//
// The real package calls TurboModuleRegistry.getEnforcing('RNCWebViewModule')
// at import time, which throws under the jest/node test env (no native binary).
// Any test that renders a screen importing <WebView> (e.g. the Phase-G4.3 HUD
// wrappers reached through AppNavigator) would fail to even load the suite.
// This stub renders an inert element so component/navigation tests can run.
const React = require('react');

const WebView = React.forwardRef((props, ref) =>
  React.createElement('WebView', { ...props, ref }),
);
WebView.displayName = 'WebView';

module.exports = { WebView, default: WebView };
