// Root appearance policy with installed React Native boundaries mocked; no
// transport, storage, auth or simulator writes. Existing feature suites cover
// the screen behaviors that this policy must leave unchanged.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { runtime, nodes } = require('./personal-places.cjs');

(async () => {
    for (const platform of ['ios', 'android', 'web']) {
        const applied = [];
        const rt = runtime({ platform, mocks: {
            '@react-navigation/native': { DefaultTheme: { dark: false, colors: {}, fonts: { regular: { fontFamily: 'System' } } },
                ThemeProvider: 'ThemeProvider' },
            'expo-status-bar': { StatusBar: 'StatusBar' },
            '@/providers/auth': { AuthProvider: 'AuthProvider' },
        } });
        if (platform !== 'web') rt.load('react-native').Appearance = { setColorScheme: value => applied.push(value) };
        else delete rt.load('react-native').Appearance;
        const Root = rt.load('app/_layout').default;
        const r = rt.render(Root, false); await r.settle();
        const elements = nodes(r.output), theme = elements.find(n => n.type === 'ThemeProvider').props.value;
        assert.equal(theme.dark, false); assert.equal(theme.colors.background, '#FFF8F0');
        assert.equal(theme.colors.primary, '#C9472C'); assert.equal(theme.colors.text, '#2D1F1A');
        assert.equal(theme.fonts.regular.fontFamily, 'System', 'installed navigation font contract is retained');
        assert.equal(elements.find(n => n.type === 'StatusBar').props.style, 'dark');
        assert(elements.some(n => n.type === 'AuthProvider'));
        assert.deepEqual(elements.filter(n => n.type === 'StackScreen').map(n => n.props.name), ['(app)', 'auth']);
        assert.equal(elements.find(n => n.type === 'Stack').props.screenOptions.contentStyle.backgroundColor, '#FFF8F0');
        r.dirty = true; await r.settle();
        assert.deepEqual(applied, platform === 'web' ? [] : ['light'], 'appearance changes do not rerender/dispose auth or install a listener');
        assert.equal(rt.world.requests.length, 0); assert.equal(rt.world.localWrites, 0); assert.equal(rt.world.intervals.size, 0);
        r.unmount(); console.log('PASS root appearance / unchanged auth routes: ' + platform);
    }
    const config = JSON.parse(fs.readFileSync('app.json', 'utf8')).expo;
    assert.equal(config.userInterfaceStyle, 'light');
    console.log('PASS native launch appearance agrees with the runtime policy');

    const rt = runtime({ platform: 'ios' });
    const react = rt.load('react');
    react.forwardRef = render => props => render(props, { current: null });
    react.useImperativeHandle = () => {};
    const Canvas = rt.load('@/components/saved-map-canvas').default;
    const input = { restaurants: [], selected: null, initialRegion: null, padding: { top: 100, bottom: 200, left: 20, right: 20 },
        showUser: false, onSelect() {}, onDismiss() {}, onRegion() {} };
    const r = rt.render(() => ({ type: Canvas, props: input }), false); await r.settle();
    const map = nodes(r.output).find(n => n.type === 'MapView');
    assert.equal(map.props.provider, 'default'); assert.equal(map.props.mapType, 'mutedStandard');
    assert.equal(map.props.userInterfaceStyle, 'light'); assert.equal(map.props.showsUserLocation, false);
    assert.equal(map.props.scrollEnabled, true); assert.equal(map.props.zoomEnabled, true);
    assert.equal(map.props.rotateEnabled, true); assert.equal(map.props.pitchEnabled, true);
    assert.equal(rt.world.requests.length, 0); r.unmount();
    console.log('PASS native Muted Standard appearance retains provider, gestures and opt-in location');
    console.log('5 appearance checks passed. Native rendering requires simulator validation.');
})().catch(error => { console.error(error); process.exitCode = 1; });
