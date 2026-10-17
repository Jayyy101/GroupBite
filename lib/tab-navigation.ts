import { StackActions, TabActions, type NavigationProp, type ParamListBase } from "@react-navigation/native";

// Replay an approved tab press using the same native actions as tab selection
// and native-stack reselect. No route keys or section state are recreated.
export function selectTabRoot(navigation: NavigationProp<ParamListBase>, key: string) {
    const state = navigation.getState();
    const route = state.routes.find(item => item.key === key);
    if (!route) return;
    if (route.state?.type === "stack" && route.state.key && (route.state.index ?? 0) > 0) {
        navigation.dispatch({ ...StackActions.popToTop(), target: route.state.key });
    }
    navigation.dispatch({ ...TabActions.jumpTo(route.name), target: state.key });
}
