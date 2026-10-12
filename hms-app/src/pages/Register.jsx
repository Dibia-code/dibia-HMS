import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '@/auth/AuthContext'
import { useBaseRepo } from '@/data/RepositoryContext'
import { ROLE } from '@/auth/roles'
import { defaultHospitalConfig } from '@/lib/hospital'
import { hashPin } from '@/lib/pin'
import { Button, Field, FormGrid, Input, useToast } from '@/components'
import { Icon } from '@/components/Icon'

const slugify = (s) =>
  s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)

// New hospital registration. Creates the hospital + a hospital admin
// account (CEO/Owner role via staff_roles), then signs in. Writes go straight
// through the repo, so a new tenant is immediately usable offline.
export default function Register() {
  const baseRepo = useBaseRepo()
  const { login } = useAuth()
  const navigate = useNavigate()
  const toast = useToast()

  const [form, setForm] = useState({ hospital: '', ownerName: '', email: '', phone: '', address: '', password: '' })
  const [errors, setErrors] = useState({})
  const [busy, setBusy] = useState(false)

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  async function submit() {
    const next = {}
    if (!form.hospital.trim()) next.hospital = 'Hospital name is required'
    if (form.password.length < 8) next.password = 'Use at least 8 characters'
    if (!form.ownerName.trim()) next.ownerName = 'Your name is required'
    if (!form.email.trim()) next.email = 'Email is required'
    setErrors(next)
    if (Object.keys(next).length) return

    setBusy(true)
    try {
      const email = form.email.trim().toLowerCase()
      // Guard against duplicate email / slug.
      if (await baseRepo.findByIndex('staff', 'by_email', email)) {
        setErrors({ email: 'An account with that email already exists' })
        return
      }
      let slug = slugify(form.hospital)
      while (await baseRepo.findByIndex('hospitals', 'by_slug', slug)) {
        slug = `${slug}-${Math.floor(performance.now()) % 1000}`
      }

      const hospital = await baseRepo.create('hospitals', {
        slug,
        name: form.hospital.trim(),
        plan: 'Freemium',
        subscriptionStatus: 'active',
        email,
        phone: form.phone.trim(),
        address: form.address.trim(),
        ...defaultHospitalConfig(),
      })
      const branch = await baseRepo.create('branches', {
        hospitalId: hospital.id,
        name: 'Main Branch',
        isMain: true,
      })
      const owner = await baseRepo.create('staff', {
        hospitalId: hospital.id,
        branchId: branch.id,
        name: form.ownerName.trim(),
        email,
        phone: form.phone.trim(),
        active: true,
      })
      await baseRepo.create('staff_roles', { staffId: owner.id, role: ROLE.FACILITY_ADMIN })
      await baseRepo.update('staff', owner.id, { passwordHash: await hashPin(form.password, owner.id) })

      await login(email, form.password)
      toast.success('Hospital created. Welcome to Dibia')
      navigate(`/${slug}/dashboard`, { replace: true })
    } catch (err) {
      toast.error(err.message || 'Could not complete registration')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card" style={{ maxWidth: 460 }}>
        <div className="brand">
          <span className="mark">
            <Icon name="activity" size={20} />
          </span>
          <span className="name">Dibia</span>
        </div>
      <h1>Create your hospital account</h1>
        <div className="sub">Free to start. No onboarding fee.</div>

        <form
          onSubmit={(e) => {
            e.preventDefault()
            submit()
          }}
        >
          <FormGrid>
            <Field label="Hospital name" htmlFor="hospital" error={errors.hospital} span2 required>
              <Input id="hospital" value={form.hospital} onChange={set('hospital')} placeholder="Demo Hospital" autoFocus />
            </Field>
            <Field label="Your name" htmlFor="ownerName" error={errors.ownerName} required>
              <Input id="ownerName" value={form.ownerName} onChange={set('ownerName')} placeholder="Adaeze John" />
            </Field>
            <Field label="Phone number" htmlFor="phone" hint="You can also sign in with this number">
              <Input id="phone" value={form.phone} onChange={set('phone')} placeholder="0803 000 0000" />
            </Field>
            <Field label="Password" htmlFor="password" error={errors.password} span2 required hint="At least 8 characters. You will use it with your email or phone number to sign in.">
              <Input id="password" type="password" autoComplete="new-password" value={form.password} onChange={set('password')} />
            </Field>
            <Field label="Hospital address" htmlFor="address" span2>
              <Input id="address" value={form.address} onChange={set('address')} placeholder="Street, town, state" />
            </Field>
            <Field label="Email" htmlFor="email" error={errors.email} span2 required>
              <Input id="email" type="email" value={form.email} onChange={set('email')} placeholder="you@hospital.ng" />
            </Field>
          </FormGrid>
          <div className="mt-2">
              <Button variant="primary" type="submit" block disabled={busy}>
              {busy ? 'Creating...' : 'Create hospital'}
            </Button>
          </div>
        </form>

        <div className="foot">
          Already have an account? <Link to="/login">Sign in</Link>
        </div>
      </div>
    </div>
  )
}
