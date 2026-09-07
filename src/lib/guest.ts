const KEY = 'liminal_guest_id';
const NAME_KEY = 'liminal_guest_name';

export function getGuestId(): string {
  let id = localStorage.getItem(KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(KEY, id);
  }
  return id;
}

export function getGuestName(): string {
  let name = localStorage.getItem(NAME_KEY);
  if (!name) {
    name = `Player${Math.floor(1000 + Math.random() * 9000)}`;
    localStorage.setItem(NAME_KEY, name);
  }
  return name;
}

export function setGuestName(name: string): void {
  localStorage.setItem(NAME_KEY, name.trim().slice(0, 20) || getGuestName());
}

export function getChipBank(): number {
  const v = localStorage.getItem('liminal_chip_bank');
  if (v == null) {
    localStorage.setItem('liminal_chip_bank', '10000');
    return 10000;
  }
  return parseInt(v, 10) || 10000;
}

export function setChipBank(n: number): void {
  localStorage.setItem('liminal_chip_bank', String(Math.max(0, Math.floor(n))));
}
