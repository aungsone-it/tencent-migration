import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Edit3, Loader2, Plus, Sparkles, Trash2, Users } from "lucide-react";
import { toast } from "sonner";
import { cloudbaseApiBaseUrl, cloudbasePublishableKey, getCloudBaseRequestHeaders } from "../../../../utils/supabase/info";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../ui/dialog";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Textarea } from "../ui/textarea";
import { Switch } from "../ui/switch";

type SubscriptionPlan = {
  id: string;
  vendorId: string;
  name: string;
  description: string;
  price: number;
  promises: string[];
  status: "active" | "inactive";
};

const EMPTY_FORM = {
  name: "",
  description: "",
  price: "",
  promises: "",
  active: true,
};

function headers(json = false): Record<string, string> {
  return {
    ...getCloudBaseRequestHeaders(),
    ...(cloudbasePublishableKey ? { Authorization: `Bearer ${cloudbasePublishableKey}` } : {}),
    ...(json ? { "Content-Type": "application/json" } : {}),
  };
}

function formatMmk(value: number): string {
  return `${Math.round(value).toLocaleString()} MMK`;
}

export function VendorAdminSubscriptions({ vendorId }: { vendorId: string; vendorName: string }) {
  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<SubscriptionPlan | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);

  const loadPlans = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(
        `${cloudbaseApiBaseUrl}/vendor/subscription-plans/${encodeURIComponent(vendorId)}?includeInactive=1`,
        { headers: headers() },
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Failed to load plans");
      setPlans(Array.isArray(data.plans) ? data.plans : []);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load plans");
    } finally {
      setLoading(false);
    }
  }, [vendorId]);

  useEffect(() => {
    void loadPlans();
  }, [loadPlans]);

  const activeCount = useMemo(() => plans.filter((plan) => plan.status === "active").length, [plans]);

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  };

  const openEdit = (plan: SubscriptionPlan) => {
    setEditing(plan);
    setForm({
      name: plan.name,
      description: plan.description,
      price: String(plan.price),
      promises: plan.promises.join("\n"),
      active: plan.status === "active",
    });
    setDialogOpen(true);
  };

  const save = async () => {
    const price = Math.round(Number(form.price));
    const promises = form.promises.split("\n").map((value) => value.trim()).filter(Boolean);
    if (!form.name.trim() || !form.description.trim() || price <= 0 || promises.length === 0) {
      toast.error("Add a name, description, monthly price, and at least one promise.");
      return;
    }
    setSaving(true);
    try {
      const base = `${cloudbaseApiBaseUrl}/vendor/subscription-plans/${encodeURIComponent(vendorId)}`;
      const response = await fetch(
        editing ? `${base}/${encodeURIComponent(editing.id)}` : base,
        {
          method: editing ? "PUT" : "POST",
          headers: headers(true),
          body: JSON.stringify({
            name: form.name,
            description: form.description,
            price,
            promises,
            status: form.active ? "active" : "inactive",
          }),
        },
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Failed to save plan");
      toast.success(editing ? "Subscription plan updated" : "Subscription plan created");
      setDialogOpen(false);
      await loadPlans();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save plan");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (plan: SubscriptionPlan) => {
    if (!window.confirm(`Delete “${plan.name}”? Existing subscribers keep their paid period.`)) return;
    try {
      const response = await fetch(
        `${cloudbaseApiBaseUrl}/vendor/subscription-plans/${encodeURIComponent(vendorId)}/${encodeURIComponent(plan.id)}`,
        { method: "DELETE", headers: headers() },
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Failed to delete plan");
      toast.success("Subscription plan deleted");
      await loadPlans();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to delete plan");
    }
  };

  if (loading) {
    return <div className="flex h-64 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-slate-500" /></div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Subscriptions</h1>
          <p className="text-slate-600">Offer monthly memberships with clear promises for your followers.</p>
        </div>
        <Button onClick={openCreate} disabled={plans.length >= 10} className="bg-slate-900 hover:bg-slate-800">
          <Plus className="mr-2 h-4 w-4" /> Create plan
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card className="p-5">
          <div className="flex items-center justify-between">
            <div><p className="text-sm text-slate-500">Plans created</p><p className="mt-1 text-3xl font-bold">{plans.length} / 10</p><p className="text-xs text-slate-500">{activeCount} published</p></div>
            <Sparkles className="h-8 w-8 text-amber-500" />
          </div>
        </Card>
        <Card className="p-5">
          <div className="flex items-center justify-between">
            <div><p className="text-sm text-slate-500">Billing</p><p className="mt-1 font-semibold">Monthly · manual renewal</p></div>
            <Users className="h-8 w-8 text-violet-500" />
          </div>
        </Card>
      </div>

      {plans.length === 0 ? (
        <Card className="p-12 text-center">
          <Sparkles className="mx-auto mb-4 h-12 w-12 text-slate-300" />
          <h2 className="font-semibold text-slate-900">No subscription plans yet</h2>
          <p className="mt-1 text-sm text-slate-500">Create a tier and tell subscribers what you promise to deliver each month.</p>
          <Button className="mt-5" onClick={openCreate}><Plus className="mr-2 h-4 w-4" /> Create your first plan</Button>
        </Card>
      ) : (
        <div className="grid gap-5 lg:grid-cols-3">
          {plans.map((plan) => (
            <Card key={plan.id} className="flex flex-col overflow-hidden">
              <div className="flex-1 p-6">
                <div className="flex items-start justify-between gap-3">
                  <h2 className="text-xl font-bold">{plan.name}</h2>
                  <Badge variant={plan.status === "active" ? "default" : "secondary"}>{plan.status}</Badge>
                </div>
                <p className="mt-2 text-2xl font-bold">{formatMmk(plan.price)} <span className="text-sm font-normal text-slate-500">/ month</span></p>
                <p className="mt-3 text-sm text-slate-600">{plan.description}</p>
                <ul className="mt-5 space-y-2">
                  {plan.promises.map((promise) => <li key={promise} className="flex gap-2 text-sm"><Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />{promise}</li>)}
                </ul>
              </div>
              <div className="flex gap-2 border-t bg-slate-50 p-4">
                <Button variant="outline" className="flex-1" onClick={() => openEdit(plan)}><Edit3 className="mr-2 h-4 w-4" /> Edit</Button>
                <Button variant="outline" size="icon" className="text-red-600" onClick={() => void remove(plan)}><Trash2 className="h-4 w-4" /></Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader><DialogTitle>{editing ? "Edit subscription plan" : "Create subscription plan"}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div><Label>Plan name</Label><Input value={form.name} maxLength={80} placeholder="Inner Circle" onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div><Label>Monthly price (MMK)</Label><Input type="number" min="1" step="1" value={form.price} placeholder="10000" onChange={(e) => setForm({ ...form, price: e.target.value })} /></div>
            <div><Label>Description</Label><Textarea value={form.description} maxLength={600} rows={3} placeholder="Who this membership is for..." onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
            <div>
              <Label>Promises to subscribers</Label>
              <Textarea value={form.promises} rows={6} placeholder={"Exclusive weekly video\nMonthly live Q&A\nSubscriber-only discount"} onChange={(e) => setForm({ ...form, promises: e.target.value })} />
              <p className="mt-1 text-xs text-slate-500">One promise per line, up to 10.</p>
            </div>
            <div className="flex items-center justify-between rounded-lg border p-4">
              <div><Label>Publish this plan</Label><p className="text-xs text-slate-500">Visible on your storefront immediately.</p></div>
              <Switch checked={form.active} onCheckedChange={(active) => setForm({ ...form, active })} />
            </div>
            <div className="flex justify-end gap-2 border-t pt-4">
              <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button onClick={() => void save()} disabled={saving}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Save plan</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
