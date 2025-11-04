import { Link, useLocation } from 'react-router-dom';

export default function ChildTabNav() {
  const location = useLocation();

  const tabs = [
    { path: '/child/today', label: '오늘할일', icon: '📋' },
    { path: '/child/upload', label: '업로드', icon: '📸' },
    { path: '/child/rewards', label: '보상', icon: '🎁' },
    { path: '/child/profile', label: '프로필', icon: '👤' },
  ];

  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 shadow-lg z-50">
      <div className="flex justify-around items-center h-16">
        {tabs.map((tab) => {
          const isActive = location.pathname === tab.path;
          return (
            <Link
              key={tab.path}
              to={tab.path}
              className={`flex flex-col items-center justify-center flex-1 h-full transition-colors ${
                isActive
                  ? 'text-orange-600 bg-orange-50'
                  : 'text-gray-600 hover:text-gray-800'
              }`}
            >
              <span className="text-xl mb-1">{tab.icon}</span>
              <span className="text-xs font-medium">{tab.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

