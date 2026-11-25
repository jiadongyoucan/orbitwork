import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowRight, Box, Check, ChevronRight, Download, Layers, Package, Plus, Search, Sparkles,
  Star, Store, Users, X,
} from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import type { Asset, AssetKind } from '@/lib/types';
import { Badge, EmptyState, ErrorState, Field, Modal, PageHeader, Spinner } from '@/components/UI';
import { Icon } from '@/components/Icon';
import { cn, compactNumber, safeJson } from '@/lib/utils';

const KIND_LABELS: Record<string, string> = { all: '全部', expert: '专家', skill: '技能', connector: '连接器', plugin: '插件' };
const KIND_ICONS: Record<string, string> = { expert: 'graduation-cap', skill: 'book-open', connector: 'plug', plugin: 'package' };

export default function MarketPage() {
  const { workspace } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [items, setItems] = useState<Asset[]>([]);
  const [myAssets, setMyAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [canPublish, setCanPublish] = useState(true);
  const [kind, setKind] = useState('all');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState('featured');
  const [selected, setSelected] = useState<Asset | null>(null);
  const [installing, setInstalling] = useState('');
  const [starring, setStarring] = useState('');
  const [publishOpen, setPublishOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [pluginForm, setPluginForm] = useState({ name: '', summary: '', description: '', category: '效率', version: '1.0.0' });
  const [publishing, setPublishing] = useState(false);

  async function load() {
    setLoading(true);
    setLoadError('');
    try {
      const params = new URLSearchParams();
      if (kind !== 'all') params.set('kind', kind);
      if (q.trim()) params.set('q', q.trim());
      params.set('sort', sort);
      const marketPromise = api.get<{ items: Asset[] }>(`/api/market?${params.toString()}`);
      const assetsPromise = workspace ? api.get<{ assets: Asset[] }>(`/api/w/${workspace.id}/assets`) : Promise.resolve({ assets: [] as Asset[] });
      const settingsPromise = workspace ? api.get<{ role: string; settings: { allowMemberPublish?: boolean } }>(`/api/w/${workspace.id}/settings`) : Promise.resolve(null);
      const [data, mine, settings] = await Promise.all([marketPromise, assetsPromise, settingsPromise]);
      setItems(data.items);
      setMyAssets(mine.assets);
      if (settings) setCanPublish(settings.role !== 'member' || settings.settings.allowMemberPublish !== false);
    } catch (caught) {
      const message = errorMessage(caught);
      setLoadError(message);
      toast.push(message, 'error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [workspace, kind, sort]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 260);
    return () => window.clearTimeout(timer);
  }, [q]);

  async function install(asset: Asset) {
    if (!workspace) return;
    setInstalling(asset.id);
    try {
      const result = await api.post<{ installedAssetId: string; kind: AssetKind }>(`/api/w/${workspace.id}/assets/${asset.id}/install`);
      const targetKind = asset.kind === 'plugin'
        ? String((asset.payload.items as Array<{ kind?: string }> | undefined)?.[0]?.kind ?? 'expert')
        : result.kind;
      toast.push(result.kind === 'plugin' ? '插件已安装，组成能力已加入工作区' : `「${asset.name}」已安装到工作区`, 'success');
      setSelected(null);
      await load();
      const routes: Record<string, string> = { expert: '/app/experts', skill: '/app/skills', connector: '/app/connectors', plugin: '/app/experts' };
      const route = routes[targetKind] ?? '/app/experts';
      if (targetKind === 'connector') toast.push('连接器已安装，请编辑并填写访问密钥', 'info');
      navigate(route);
    } catch (caught) {
      toast.push(errorMessage(caught), 'error');
    } finally {
      setInstalling('');
    }
  }

  async function star(asset: Asset) {
    if (!workspace) return;
    setStarring(asset.id);
    try {
      const result = await api.post<{ starred: boolean; stars: number }>(`/api/w/${workspace.id}/assets/${asset.id}/star`);
      setItems((current) => current.map((item) => item.id === asset.id ? { ...item, starred: result.starred, stars: result.stars } : item));
      setSelected((current) => current?.id === asset.id ? { ...current, starred: result.starred, stars: result.stars } : current);
    } catch (caught) {
      toast.push(errorMessage(caught), 'error');
    } finally {
      setStarring('');
    }
  }

  async function publishPlugin(event: React.FormEvent) {
    event.preventDefault();
    if (!workspace) return;
    if (selectedIds.length === 0) { toast.push('至少选择一项能力', 'error'); return; }
    setPublishing(true);
    try {
      const chosen = myAssets.filter((asset) => selectedIds.includes(asset.id));
      const payload = {
        items: chosen.map((asset) => ({ kind: asset.kind, name: asset.name, summary: asset.summary, payload: asset.payload })),
      };
      let created: { asset: Asset } | null = null;
      try {
        created = await api.post<{ asset: Asset }>(`/api/w/${workspace.id}/assets`, {
          kind: 'plugin', name: pluginForm.name, summary: pluginForm.summary, description: pluginForm.description,
          category: pluginForm.category, icon: 'package', version: pluginForm.version, payload,
        });
        await api.post(`/api/w/${workspace.id}/assets/${created.asset.id}/publish`, { version: pluginForm.version });
      } catch (error) {
        if (created) await api.delete(`/api/w/${workspace.id}/assets/${created.asset.id}`).catch(() => undefined);
        throw error;
      }
      toast.push('插件已创建并发布到市场', 'success');
      setPublishOpen(false);
      setSelectedIds([]);
      setPluginForm({ name: '', summary: '', description: '', category: '效率', version: '1.0.0' });
      await load();
      navigate('/app/experts');
    } catch (caught) {
      toast.push(errorMessage(caught), 'error');
    } finally {
      setPublishing(false);
    }
  }

  const publishable = myAssets.filter((asset) => asset.kind !== 'plugin');

  return (
    <div className="page-wrap fade-in">
      <PageHeader
        eyebrow="Marketplace"
        title="插件市场"
        subtitle="安装团队验证过的专家、技能与连接器。也可以把你的方法打包发布。"
        actions={
          <>
            <button className="btn" onClick={() => setPublishOpen(true)} disabled={!canPublish} title={canPublish ? '把已有能力打包发布' : '管理员已关闭成员发布权限'}><Package size={14} />发布插件</button>
            <button className="btn btn-primary" onClick={() => navigate('/app/experts')}><Layers size={14} />管理能力</button>
          </>
        }
      />

      <div className="card" style={{ padding: '22px 24px', marginBottom: 18, background: 'linear-gradient(120deg, rgba(200,247,104,.08), rgba(139,211,255,.04) 55%, transparent)' }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 18, flexWrap: 'wrap' }}>
          <div>
            <div className="eyebrow" style={{ color: 'rgba(200,247,104,.7)' }}>Curated capabilities</div>
            <div style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-.04em', marginTop: 7 }}>站在别人的方法上，继续向前。</div>
            <p style={{ color: 'var(--muted)', fontSize: 12, margin: '7px 0 0', lineHeight: 1.6 }}>每一次安装都来自发布者确认的不可变版本。密钥、凭据不会随插件传播。</p>
          </div>
          <div style={{ display: 'flex', gap: 18 }}>
            <div><div style={{ fontSize: 22, fontWeight: 700 }}>{items.length}</div><div style={{ fontSize: 10, color: 'var(--faint)' }}>当前结果</div></div>
            <div><div style={{ fontSize: 22, fontWeight: 700 }}>{publishable.length}</div><div style={{ fontSize: 10, color: 'var(--faint)' }}>我的可打包能力</div></div>
          </div>
        </div>
      </div>

      <div className="toolbar" style={{ justifyContent: 'space-between', marginBottom: 18 }}>
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
          {Object.entries(KIND_LABELS).map(([key, label]) => (
            <button key={key} className={cn('chip', kind === key && 'chip-active')} onClick={() => setKind(key)}>{label}</button>
          ))}
        </div>
        <div className="toolbar">
          <div className="search"><Search size={14} /><input className="input" aria-label="搜索能力" placeholder="搜索能力…" value={q} onChange={(event) => setQ(event.target.value)} /></div>
          <select className="select" style={{ width: 126, height: 36 }} value={sort} onChange={(event) => setSort(event.target.value)}>
            <option value="featured">精选优先</option>
            <option value="new">最新发布</option>
            <option value="stars">最高评分</option>
          </select>
        </div>
      </div>

      {loadError && items.length > 0 && <div className="card" style={{ padding: '9px 13px', marginBottom: 14, color: 'var(--danger)', borderColor: 'rgba(255,122,122,.25)', fontSize: 11.5 }}>{loadError} <button className="btn btn-sm btn-ghost" onClick={() => void load()}>重试</button></div>}
      {loading ? (
        <div className="grid-3">{Array.from({ length: 6 }).map((_, index) => <div key={index} className="skeleton" style={{ height: 205 }} />)}</div>
      ) : loadError && items.length === 0 ? (
        <div className="card"><ErrorState message={loadError} onRetry={() => void load()} /></div>
      ) : items.length === 0 ? (
        <div className="card"><EmptyState icon={<Store size={20} />} title="没有找到匹配的能力" description="换个关键词，或清除筛选条件。" action={<button className="btn btn-sm" onClick={() => { setQ(''); setKind('all'); }}>清除筛选</button>} /></div>
      ) : (
        <div className="grid-3">
          {items.map((item) => {
            const own = item.workspaceId === workspace?.id;
            return (
              <div key={item.id} className="card card-hover asset-card" style={{ cursor: 'pointer' }} role="button" tabIndex={0} onClick={() => setSelected(item)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelected(item); } }}>
                <div className="asset-card-head">
                  <div className="asset-ico"><Icon name={item.icon} size={16} /></div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <h3>{item.name}</h3>
                      {item.featured && <Badge tone="accent">精选</Badge>}
                    </div>
                    <div style={{ display: 'flex', gap: 5, marginTop: 5 }}>
                      <Badge tone="muted">{KIND_LABELS[item.kind]}</Badge>
                      <span style={{ fontSize: 10, color: 'var(--faint)', alignSelf: 'center' }}>{item.category} · v{item.version}</span>
                    </div>
                  </div>
                </div>
                <p className="summary" style={{ minHeight: 38 }}>{item.summary}</p>
                <div className="asset-foot" style={{ borderTop: '1px solid var(--line)', paddingTop: 11 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 10, color: 'var(--faint)' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}><Download size={10} />{compactNumber(item.installs)}</span>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}><Star size={10} />{compactNumber(item.stars)}</span>
                    <span>{item.authorName}</span>
                  </div>
                  <button
                    className="btn btn-sm"
                    style={{ height: 28, padding: '0 9px', fontSize: 11 }}
                    onClick={(event) => { event.stopPropagation(); if (!own) void install(item); }}
                    disabled={own || installing === item.id}
                  >
                    {installing === item.id ? <Spinner size={11} /> : own ? <Check size={11} /> : <Plus size={11} />}
                    {own ? '已拥有' : '安装'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Modal
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
        title={selected?.name ?? ''}
        subtitle={selected ? `${KIND_LABELS[selected.kind]} · ${selected.category} · v${selected.version}` : ''}
        large
        footer={selected ? (
          <>
            <button className="btn" onClick={() => void star(selected)} disabled={starring === selected.id}><Star size={14} fill={selected.starred ? 'var(--accent)' : 'none'} />{selected.starred ? '已收藏' : '收藏'} {selected.stars}</button>
            <button className="btn btn-primary" disabled={selected.workspaceId === workspace?.id || installing === selected.id} onClick={() => void install(selected)}>
              {installing === selected.id ? <Spinner size={13} /> : <Download size={14} />}
              {selected.workspaceId === workspace?.id ? '你的工作区资产' : '安装到工作区'}
            </button>
          </>
        ) : null}
      >
        {selected && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <div className="asset-ico" style={{ width: 44, height: 44, borderRadius: 12 }}><Icon name={selected.icon} size={21} /></div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.6 }}>{selected.summary}</div>
                <div style={{ fontSize: 10, color: 'var(--faint)', marginTop: 6 }}>由 {selected.authorName} 发布 · {compactNumber(selected.installs)} 次安装</div>
              </div>
            </div>
            <p style={{ fontSize: 12.5, lineHeight: 1.75, color: 'var(--text)', margin: 0, whiteSpace: 'pre-wrap' }}>{selected.description || '发布者暂未提供详细说明。'}</p>
            {selected.kind === 'plugin' && Array.isArray(selected.payload.items) && (
              <div>
                <div className="label" style={{ marginBottom: 7 }}>包含 {selected.payload.items.length} 项能力</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  {(selected.payload.items as Array<{ kind: string; name: string; summary: string }>).map((item, index) => (
                    <div key={index} className="list-row" style={{ padding: '9px 11px', border: '1px solid var(--line)', borderRadius: 8 }}>
                      <Icon name={KIND_ICONS[item.kind] || 'box'} size={14} />
                      <span style={{ flex: 1, fontSize: 12 }}>{item.name}</span>
                      <Badge tone="muted">{KIND_LABELS[item.kind]}</Badge>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <details>
              <summary style={{ fontSize: 11, color: 'var(--faint)', cursor: 'pointer' }}>查看版本快照摘要</summary>
              <pre className="console" style={{ marginTop: 8, maxHeight: 220 }}>{safeJson(selected.payload).slice(0, 4000)}</pre>
            </details>
            <div className="hint">安装会复制一份草稿到你的工作区，不会执行发布者的代码。连接器凭据需由你自行填写。</div>
          </div>
        )}
      </Modal>

      <Modal
        open={publishOpen}
        onClose={() => setPublishOpen(false)}
        title="发布插件"
        subtitle="选择你的能力打包，发布为一个可一键安装的插件。"
        large
        footer={<><button className="btn" onClick={() => setPublishOpen(false)}>取消</button><button className="btn btn-primary" form="plugin-form" disabled={publishing}>{publishing ? <Spinner size={13} /> : <Sparkles size={13} />}创建并发布</button></>}
      >
        <form id="plugin-form" onSubmit={publishPlugin} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="grid-2">
            <Field label="插件名称"><input className="input" required maxLength={48} value={pluginForm.name} onChange={(event) => setPluginForm({ ...pluginForm, name: event.target.value })} placeholder="例如：客户成功工具箱" /></Field>
            <Field label="分类"><input className="input" value={pluginForm.category} onChange={(event) => setPluginForm({ ...pluginForm, category: event.target.value })} /></Field>
          </div>
          <Field label="简介" hint="至少 8 个字"><input className="input" required value={pluginForm.summary} onChange={(event) => setPluginForm({ ...pluginForm, summary: event.target.value })} placeholder="一句话说明组合价值" /></Field>
          <Field label="详细说明"><textarea className="textarea" rows={2} value={pluginForm.description} onChange={(event) => setPluginForm({ ...pluginForm, description: event.target.value })} /></Field>
          <div>
            <div className="label" style={{ marginBottom: 7 }}>选择能力（{selectedIds.length}）</div>
            <div style={{ border: '1px solid var(--line)', borderRadius: 10, maxHeight: 260, overflowY: 'auto', padding: 4 }}>
              {publishable.length === 0 ? <div className="hint" style={{ padding: 12 }}>还没有可打包的能力。先创建专家、技能或连接器。</div> : publishable.map((asset) => (
                <button type="button" key={asset.id} className="nav-item" onClick={() => setSelectedIds((current) => current.includes(asset.id) ? current.filter((id) => id !== asset.id) : [...current, asset.id])}>
                  <span className={cn('toggle', selectedIds.includes(asset.id) && 'on')} style={{ transform: 'scale(.78)', marginRight: -3 }} />
                  <Icon name={asset.icon} size={14} />
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{asset.name}</span>
                  <Badge tone="muted">{KIND_LABELS[asset.kind]}</Badge>
                </button>
              ))}
            </div>
            <p className="hint" style={{ marginTop: 8 }}>插件最多包含 10 项能力；连接器密钥不会随插件发布。</p>
          </div>
          <Field label="版本"><input className="input mono" required value={pluginForm.version} onChange={(event) => setPluginForm({ ...pluginForm, version: event.target.value })} /></Field>
        </form>
      </Modal>
    </div>
  );
}
