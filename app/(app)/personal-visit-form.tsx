import { PersonalAccess } from "@/components/personal-access";
import { ScreenScaffold } from "@/components/screen-scaffold";
import { VisitFields, type VisitFieldsValue } from "@/components/visit-fields";
import { useForegroundRefresh } from "@/hooks/use-foreground-refresh";
import { useLeaveGuard } from "@/hooks/use-leave-guard";
import { getPersonalPlace, normalizePersonalPlace } from "@/lib/personal-places";
import { listPersonalVisits, managePersonalVisit } from "@/lib/personal-visits";
import { isUuid } from "@/lib/restaurant-ui";
import { personalPlaceHref } from "@/lib/restaurant-navigation";
import { useAuth } from "@/providers/auth";
import { backendStyles as styles } from "@/styles/backend";
import type { PersonalVisit } from "@/types/database";
import { useIsFocused } from "@react-navigation/native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { AppState, Pressable, Text } from "react-native";

const memory = (v: VisitFieldsValue): VisitFieldsValue => ({ visited_on:v.visited_on, rating:v.rating, would_go_again:v.would_go_again, notes:v.notes });
export default function PersonalVisitFormScreen() {
    const { session } = useAuth();
    const params = useLocalSearchParams<{ id?: string; visitId?: string; action?: string; fromAdd?: string; fromMap?: string }>();
    return session ? <Editor key={`${session.user.id}:${JSON.stringify(params)}`} userId={session.user.id} {...params} />
        : <PersonalAccess title="Personal Visit">{() => null}</PersonalAccess>;
}
function Editor({ userId, id, visitId, action, fromAdd, fromMap }: { userId: string; id?: string; visitId?: string; action?: string; fromAdd?: string; fromMap?: string }) {
    const router = useRouter(), { session, loading: authLoading } = useAuth();
    const focused = useIsFocused(), { isActive, version } = useForegroundRefresh();
    const [visit,setVisit] = useState<PersonalVisit | null>(null), [fields,setFields] = useState<VisitFieldsValue>({ visited_on:null,rating:null,would_go_again:null,notes:null });
    const [loading,setLoading] = useState(true), [error,setError] = useState(""), [busy,setBusy] = useState(false), [blocked,setBlocked] = useState(false), [refresh,setRefresh] = useState(0);
    const alive=useRef(false), visible=useRef(false), epoch=useRef(0), verified=useRef(false), original=useRef<PersonalVisit | null>(null);
    const pending=useRef(false), locked=useRef(false), completed=useRef(false), intended=useRef<VisitFieldsValue | null>(null);
    const remove = action === "delete";
    visible.current = focused && isActive && !authLoading && session?.user.id === userId;
    const canOperate = () => alive.current && visible.current && !completed.current && AppState.currentState === "active";
    const leave = useLeaveGuard({ userId, dirty:!!visit && JSON.stringify(fields)!==JSON.stringify(memory(visit)), busy,
        uncertain:blocked, uncertainExitMessage:"This visit may already have changed. Leaving does not undo it. Refresh the place before making another change.",
        onDiscard:() => { completed.current=true; } });
    useEffect(() => {
        alive.current=true;
        const sub=AppState.addEventListener("change",state => { if(state!=="active") { epoch.current++;verified.current=false; } });
        return () => { alive.current=false;sub.remove(); };
    },[]);
    useEffect(() => {
        verified.current=false;setLoading(true);
        if(!focused||!isActive) return;
        let valid=true;const readEpoch=epoch.current;
        void(async()=>{
            try {
                if(!isUuid(id)||!isUuid(visitId)|| ![undefined,"edit","delete"].includes(action)) throw new Error();
                const place=await getPersonalPlace(userId,id);
                const visits=place ? await listPersonalVisits(userId,id) : [];
                if(!valid||!canOperate()||readEpoch!==epoch.current) return;
                const current=visits.find(v=>v.id===visitId);
                if(!current) throw new Error();
                if(!original.current) { original.current=current;setVisit(current);setFields(memory(current)); }
                else if(original.current.revision!==current.revision && !locked.current && !pending.current) {
                    locked.current=true;setBlocked(true);setError("This visit changed while you were away. Your draft is retained. Return and refresh before editing again.");
                }
                verified.current=true;
            } catch { if(valid)setError("This personal visit is unavailable, or access could not be verified. Return to the place or refresh."); }
            finally { if(valid)setLoading(false); }
        })();
        return ()=>{valid=false;verified.current=false;};
        // Retain the original optimistic revision and draft on revalidation.
    },[userId,id,visitId,action,focused,isActive,version,refresh]);
    function returnToPlace() {
        if(!canOperate()||pending.current)return;
        leave.requestLeave(()=>isUuid(id)?router.dismissTo(personalPlaceHref(id,fromAdd==="1",fromMap==="1"),{withAnchor:true}):router.dismissTo("/my-places",{withAnchor:true}));
    }
    function finish() {
        if(!canOperate()||!isUuid(id))return;
        completed.current=true;
        leave.finish(()=>router.dismissTo(personalPlaceHref(id,fromAdd==="1",fromMap==="1"),{withAnchor:true}));
    }
    async function save() {
        if(!canOperate()||!verified.current||!visit||loading||pending.current||locked.current)return;
        let value:VisitFieldsValue;
        try { value=memory(normalizePersonalPlace({name:"visit",address:"visit",cuisine:null,...fields})); }
        catch {setError("Check the visit date and optional fields.");return;}
        pending.current=true;setBusy(true);setError("");const saveEpoch=epoch.current;intended.current=value;
        try {
            const sent=await managePersonalVisit(userId,visit,value,remove,()=>canOperate()&&verified.current&&epoch.current===saveEpoch);
            if(!sent)return;
            locked.current=true;if(alive.current)setBlocked(true);
            if(canOperate()&&epoch.current===saveEpoch)finish();
        } catch {locked.current=true;if(alive.current){setBlocked(true);setError("Could not confirm this change. Check Saved Visit; this form will not send it again.");}}
        finally {pending.current=false;if(alive.current)setBusy(false);}
    }
    async function check() {
        if(!canOperate()||pending.current||!isUuid(id)||!intended.current)return;
        pending.current=true;setBusy(true);const readEpoch=epoch.current;
        try {
            const visits=await listPersonalVisits(userId,id),current=visits.find(v=>v.id===visitId);
            if(!canOperate()||epoch.current!==readEpoch)return;
            if(remove?!current:!!current&&JSON.stringify(memory(current))===JSON.stringify(intended.current))finish();
            else setError("The current visit does not confirm this change. Keep checking, or return and refresh before another change.");
        } catch {if(canOperate())setError("Could not check this visit. Try checking again or return to the place.");}
        finally {pending.current=false;if(alive.current)setBusy(false);}
    }
    return <>{leave.confirmation}<PersonalAccess title="Personal Visit">{()=> <ScreenScaffold edgeToEdge includeBottomInset busy={busy} onBack={returnToPlace}
        keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" automaticallyAdjustKeyboardInsets>
        <Text style={styles.title}>{remove?"Delete Personal Visit":"Edit Personal Visit"}</Text>
        {loading?<Text style={styles.message}>Verifying personal visit...</Text>:verified.current&&visit?<>
            {remove?<Text style={styles.message}>Delete only this visit? Your restaurant card and other visits will remain.</Text>:<VisitFields value={fields} disabled={busy||blocked}
                onChange={value=>{if(canOperate()&&!locked.current&&!pending.current)setFields(value);}}/>}
            <Pressable accessibilityRole="button" disabled={busy||blocked} onPress={save} style={styles.primaryButton}>
                <Text style={styles.primaryText}>{busy?"Saving...":remove?"Confirm Delete Visit":"Save Changes"}</Text></Pressable>
        </>:null}
        {error!==""&&<Text style={styles.error}>{error}</Text>}
        {blocked&&<Pressable accessibilityRole="button" disabled={busy} onPress={check} style={styles.secondaryButton}><Text style={styles.secondaryText}>Check Saved Visit</Text></Pressable>}
        <Pressable accessibilityRole="button" disabled={busy} onPress={()=>{if(canOperate()&&!pending.current)setRefresh(v=>v+1);}} style={styles.secondaryButton}><Text style={styles.secondaryText}>Refresh Visit</Text></Pressable>
    </ScreenScaffold>}</PersonalAccess></>;
}
