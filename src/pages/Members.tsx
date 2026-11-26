import { useEffect, useState } from 'react';
import {
  Activity, Calendar, Check, Clipboard, Clock3, Copy, KeyRound, Mail, MoreHorizontal, Plus,
  RefreshCw, Shield, ShieldCheck, Trash2, UserMinus, UserPlus, Users,
} from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import type { AuditLog, Invite, Member } from '@/lib/types';
import { Avatar, Badge, ConfirmModal, CopyButton, EmptyState, Field, Modal, Spinner } from '@/components/UI';
import { cn, formatDate } from '@/lib/utils';

export function MembersPanel() {
  const { workspace, user } = useAuth();
  const toast = useToast();
  const [tab, setTab] = useState<'members' | 'audit'>('members');
  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [myRole, setMyRole] = useState('member');
  const [audit, setAudit] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteForm, setInviteForm] = useState({ email: '', role: 'member' });
  const [inviteUrl, setInviteUrl] = useState('');
  const [inviting, setInviting] = useState(false);
  const [removing, setRemoving] = useState<Member | null>(null);
  const [removeLoading, setRemoveLoading] = useState(false);

  const isAdmin = myRole === 'owner' || myRole === 'admin';

  async function load() {
    if (!workspace) return;
    setLoading(true);
    try {
      const data = await api.get<{ members: Member[]; invites: Invite[]; myRole: string }>(`/api/w/${workspace.id}/members`);
      setMembers(data.members);
      setInvites(data.invites);
      setMyRole(data.myRole);
      if (isAdmin || data.myRole === 'owner' || data.myRole === 'admin') {
        try {
          const logs = await api.get<{ logs: AuditLog[] }>(`/api/w/${workspace.id}/audit`);
          setAudit(logs.logs);
        } catch {
          setAudit([]);
        }
      }
    } catch (caught) {
      toast.push(errorMessage(caught), 'error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [workspace]);

  async function invite(event: React.FormEvent) {
    event.preventDefault();
    if (!workspace) return;
    setInviting(true);
    try {
      const result = await api.post<{ inviteUrl: string }>(`/api/w/${workspace.id}/invites`, inviteForm);
      setInviteUrl(`${window.location.origin}${result.inviteUrl}`);
      toast.push('邀请链接已生成，72 小时内有效', 'success');
      await load();
    } catch (caught) {
      toast.push(errorMessage(caught), 'error');
    } finally {
      setInviting(false);
    }
  }

  async function changeRole(member: Member, role: string) {
    if (!workspace) return;
    try {
      await api.patch(`/api/w/${workspace.id}/members/${member.id}`, { role });
      toast.push('角色已更新', 'success');
      await load();
    } catch (caught) {
      toast.push(errorMessage(caught), 'error');
    }
  }

  async function removeMember() {
    if (!workspace || !removing) return;
    setRemoveLoading(true);
    try {
      await api.delete(`/api/w/${workspace.id}/members/${removing.id}`);
      toast.push('成员已移除', 'success');
      setRemoving(null);
      await load();
    } catch (caught) {
      toast.push(errorMessage(caught), 'error');
    } finally {
      setRemoveLoading(false);
    }
  }

  const roleLabel = (role: string) => role === 'owner' ? '所有者' : role === 'admin' ? '管理员' : '成员';

  function openInvite() {
    setInviteUrl('');
    setInviteForm({ email: '', role: 'member' });
    setInviteOpen(true);
  }

  return (
    <div className="fade-in">
      {isAdmin && (
        <div className="panel-toolbar">
          <div className="tabs" style={{ margin: 0, borderBottom: 0 }}>
            <button className={cn('tab', tab === 'members' && 'active')} onClick={() => setTab('members')}>成员</button>
            <button className={cn('tab', tab === 'audit' && 'active')} onClick={() => setTab('audit')}>审计日志</button>
          </div>
          <button className="btn btn-primary btn-sm" onClick={openInvite}><UserPlus size={13} />邀请成员</button>
        </div>
      )}

      {tab === 'members' ? (
        <>
          {loading ? <div className="skeleton" style={{ height: 220 }} /> : (
            <>
              <div className="card" style={{ marginBottom: 18 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '13px 16px', borderBottom: '1px solid var(--line)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, fontWeight: 600 }}><Users size={14} />{members.length} 位成员</div>
                </div>
                {members.map((member) => (
                  <div className="list-row" key={member.id}>
                    <Avatar name={member.name} size={33} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 550, display: 'flex', alignItems: 'center', gap: 7 }}>
                        {member.name}
                        {member.id === user?.id && <span className="badge badge-muted">你</span>}
                        {member.role === 'owner' && <ShieldCheck size={12} color="var(--accent)" />}
                      </div>
                      <div style={{ fontSize: 10.5, color: 'var(--faint)', marginTop: 2 }}>{member.email} · 加入于 {formatDate(member.created_at)}</div>
                    </div>
                    {isAdmin && member.role !== 'owner' && member.id !== user?.id ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        <select className="select" style={{ width: 100, height: 30, fontSize: 11, padding: '4px 26px 4px 9px' }} value={member.role} onChange={(event) => void changeRole(member, event.target.value)}>
                          <option value="member">成员</option>
                          {myRole === 'owner' && <option value="admin">管理员</option>}
                        </select>
                        <button className="btn btn-ghost btn-icon btn-sm" style={{ width: 29 }} onClick={() => setRemoving(member)} aria-label="移除"><UserMinus size={13} /></button>
                      </div>
                    ) : <Badge tone={member.role === 'owner' ? 'accent' : member.role === 'admin' ? 'sky' : 'muted'}>{roleLabel(member.role)}</Badge>}
                  </div>
                ))}
              </div>

              <div className="card">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '13px 16px', borderBottom: '1px solid var(--line)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, fontWeight: 600 }}><Mail size={14} />待接受的邀请</div>
                </div>
                {invites.length === 0 ? <div className="empty" style={{ padding: 28 }}>没有待接受的邀请</div> : invites.map((invite) => (
                  <div className="list-row" key={invite.id}>
                    <div className="recent-icon"><Mail size={13} /></div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 12 }}>{invite.email}</div>
                      <div style={{ fontSize: 10, color: 'var(--faint)', marginTop: 2 }}>{roleLabel(invite.role)} · 有效期至 {formatDate(invite.expires_at)}</div>
                    </div>
                    <Badge tone="warn">待接受</Badge>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      ) : (
        <div className="card">
          {audit.length === 0 ? <EmptyState icon={<Activity size={20} />} title="暂无审计记录" description="创建工作区、成员变更、资产发布等动作会记录在这里。" /> : audit.map((log) => (
            <div className="list-row" key={log.id}>
              <div className="recent-icon"><Activity size={13} /></div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12 }}><span className="mono" style={{ color: 'var(--accent)', fontSize: 11 }}>{log.action}</span> <span style={{ color: 'var(--muted)' }}>{log.target_type}</span></div>
                <div style={{ fontSize: 10, color: 'var(--faint)', marginTop: 2 }}>{log.actor_name} · {formatDate(log.created_at)}</div>
              </div>
              <span className="mono" style={{ fontSize: 9.5, color: 'var(--faint)' }}>{log.target_id.slice(0, 8)}</span>
            </div>
          ))}
        </div>
      )}

      <Modal
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        title="邀请成员"
        subtitle="生成一次性邀请链接，发送给同事。受邀者需使用该邮箱登录。"
        footer={!inviteUrl ? <><button className="btn" onClick={() => setInviteOpen(false)}>取消</button><button className="btn btn-primary" form="invite-form" disabled={inviting}>{inviting ? <Spinner size={13} /> : <Mail size={13} />}生成邀请链接</button></> : <button className="btn btn-primary" onClick={() => setInviteOpen(false)}>完成</button>}
      >
        {!inviteUrl ? (
          <form id="invite-form" onSubmit={invite} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <Field label="邮箱"><input className="input" type="email" required value={inviteForm.email} onChange={(event) => setInviteForm({ ...inviteForm, email: event.target.value })} placeholder="teammate@company.com" /></Field>
            <Field label="角色">
              <select className="select" value={inviteForm.role} onChange={(event) => setInviteForm({ ...inviteForm, role: event.target.value })}>
                <option value="member">成员 — 使用能力与创建内容</option>
                <option value="admin">管理员 — 管理成员、设置与内容</option>
              </select>
            </Field>
          </form>
        ) : (
          <div>
            <div className="label" style={{ marginBottom: 7 }}>邀请链接（仅显示一次）</div>
            <div style={{ display: 'flex', gap: 6 }}>
              <input className="input mono" readOnly value={inviteUrl} style={{ fontSize: 11 }} />
              <CopyButton value={inviteUrl} />
            </div>
            <p className="hint" style={{ marginTop: 10 }}>72 小时内有效，接受后自动加入工作区。若对方尚未注册，请先注册后再打开链接。</p>
          </div>
        )}
      </Modal>

      <ConfirmModal open={Boolean(removing)} onClose={() => setRemoving(null)} onConfirm={() => void removeMember()} title="移除成员" description={`将「${removing?.name ?? ''}」移出工作区？其创建的会话与资产会保留。`} confirmText="移除成员" loading={removeLoading} />
    </div>
  );
}
