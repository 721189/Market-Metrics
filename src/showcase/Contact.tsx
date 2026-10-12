import React, { useState } from 'react';
import { motion } from 'motion/react';
import { Mail, Building2, MessageSquare, CheckCircle2, Send, ArrowLeft } from 'lucide-react';
import type { Page } from './router.js';

/**
 * Public contact / early-access page. A polished lead-capture form with inline
 * validation and a success state. It is a showcase surface — no backend POST is
 * wired yet; on submit it transitions to a confirmation and logs the payload.
 */

interface ContactProps {
  navigate: (page: Page) => void;
}

interface FormState {
  name: string;
  email: string;
  company: string;
  message: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const Contact: React.FC<ContactProps> = ({ navigate }) => {
  const [form, setForm] = useState<FormState>({ name: '', email: '', company: '', message: '' });
  const [errors, setErrors] = useState<Partial<FormState>>({});
  const [submitted, setSubmitted] = useState(false);

  const update = (field: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setForm(prev => ({ ...prev, [field]: e.target.value }));
    setErrors(prev => ({ ...prev, [field]: undefined }));
  };

  const validate = (): boolean => {
    const next: Partial<FormState> = {};
    if (!form.name.trim()) next.name = 'Please enter your name.';
    if (!form.email.trim()) next.email = 'Please enter your email.';
    else if (!EMAIL_RE.test(form.email.trim())) next.email = 'That email looks invalid.';
    if (!form.message.trim() || form.message.trim().length < 10)
      next.message = 'Tell us a bit more (min 10 characters).';
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    // Showcase surface: no live endpoint yet. Replace with a real POST when the
    // backend has a lead-capture route.
    console.log('Contact submission (showcase):', form);
    setSubmitted(true);
  };

  const inputBase =
    'w-full rounded-xl border bg-slate-950 px-4 py-3 text-sm text-white placeholder-slate-500 outline-none transition focus:border-cyan-500';

  return (
    <div className="mx-auto max-w-5xl px-4 py-16 sm:px-6">
      <div className="grid grid-cols-1 gap-12 lg:grid-cols-5">
        {/* Left: pitch */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="lg:col-span-2"
        >
          <button
            onClick={() => navigate('home')}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-400 transition hover:text-white"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back
          </button>
          <h1 className="mt-5 text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
            Let's talk <span className="bg-gradient-to-r from-cyan-300 to-blue-400 bg-clip-text text-transparent">evidence</span>.
          </h1>
          <p className="mt-4 text-sm leading-relaxed text-slate-400">
            Tell us the market you're evaluating. We'll show you how a
            traceable, contradiction-audited dossier beats a chatbot summary —
            usually within one working day.
          </p>

          <ul className="mt-8 space-y-4 text-sm text-slate-300">
            {[
              { icon: MessageSquare, text: 'A sample dossier for your market, free' },
              { icon: Building2, text: 'Team & enterprise onboarding' },
              { icon: Mail, text: 'Replies within one business day' },
            ].map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-cyan-500/20 bg-cyan-500/10">
                  <Icon className="h-4 w-4 text-cyan-400" />
                </span>
                {text}
              </li>
            ))}
          </ul>
        </motion.div>

        {/* Right: form / success */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, delay: 0.1 }}
          className="lg:col-span-3"
        >
          {submitted ? (
            <motion.div
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.35 }}
              className="flex flex-col items-center justify-center rounded-3xl border border-emerald-500/25 bg-emerald-500/5 p-10 text-center"
            >
              <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-500/10">
                <CheckCircle2 className="h-7 w-7 text-emerald-400" />
              </span>
              <h2 className="mt-5 text-xl font-bold text-white">Message received</h2>
              <p className="mt-2 max-w-sm text-sm leading-relaxed text-slate-400">
                Thanks{form.name ? `, ${form.name.split(' ')[0]}` : ''}. We've got your
                note and will reply to <span className="text-cyan-300">{form.email}</span> within
                one business day.
              </p>
              <button
                onClick={() => navigate('demo')}
                className="mt-6 rounded-xl border border-slate-700 bg-slate-900 px-5 py-2.5 text-sm font-bold text-white transition hover:bg-slate-800"
              >
                Explore the sample report
              </button>
            </motion.div>
          ) : (
            <form onSubmit={handleSubmit} noValidate className="rounded-3xl border border-slate-800 bg-slate-900/40 p-7">
              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-slate-300">Name</label>
                  <input
                    value={form.name}
                    onChange={update('name')}
                    placeholder="Ada Lovelace"
                    className={`${inputBase} ${errors.name ? 'border-red-500/60' : 'border-slate-800'}`}
                  />
                  {errors.name && <p className="mt-1.5 text-[11px] text-red-400">{errors.name}</p>}
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-slate-300">Email</label>
                  <input
                    value={form.email}
                    onChange={update('email')}
                    placeholder="you@company.com"
                    className={`${inputBase} ${errors.email ? 'border-red-500/60' : 'border-slate-800'}`}
                  />
                  {errors.email && <p className="mt-1.5 text-[11px] text-red-400">{errors.email}</p>}
                </div>
              </div>

              <div className="mt-5">
                <label className="mb-1.5 block text-xs font-semibold text-slate-300">
                  Company <span className="text-slate-500">(optional)</span>
                </label>
                <input
                  value={form.company}
                  onChange={update('company')}
                  placeholder="Acme Inc."
                  className={`${inputBase} border-slate-800`}
                />
              </div>

              <div className="mt-5">
                <label className="mb-1.5 block text-xs font-semibold text-slate-300">
                  What market are you evaluating?
                </label>
                <textarea
                  value={form.message}
                  onChange={update('message')}
                  rows={4}
                  placeholder="We're assessing the North American B2B AI-agent workflow space…"
                  className={`${inputBase} resize-none ${errors.message ? 'border-red-500/60' : 'border-slate-800'}`}
                />
                {errors.message && <p className="mt-1.5 text-[11px] text-red-400">{errors.message}</p>}
              </div>

              <button
                type="submit"
                className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 px-6 py-3.5 text-sm font-bold text-slate-950 shadow-lg shadow-cyan-500/20 transition hover:brightness-110 active:scale-[0.98] cursor-pointer"
              >
                <Send className="h-4 w-4" />
                Send message
              </button>
              <p className="mt-3 text-center text-[11px] text-slate-500">
                Demo form — no data is transmitted. We'll wire a real endpoint at launch.
              </p>
            </form>
          )}
        </motion.div>
      </div>
    </div>
  );
};

