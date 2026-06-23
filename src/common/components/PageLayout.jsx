import { useState } from 'react';
import {
  AppBar,
  Breadcrumbs,
  Divider,
  Drawer,
  IconButton,
  Toolbar,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import { makeStyles } from 'tss-react/mui';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import MenuIcon from '@mui/icons-material/Menu';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from './LocalizationProvider';
import BackIcon from './BackIcon';
import useVisibleReports from '../util/useVisibleReports';

const useStyles = makeStyles()((theme, { miniVariant }) => ({
  root: {
    height: '100%',
    display: 'flex',
    [theme.breakpoints.down('md')]: {
      flexDirection: 'column',
    },
  },
  menuHiddenRoot: {
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    position: 'relative',
  },
  floatingBack: {
    position: 'absolute',
    top: theme.spacing(1),
    left: theme.spacing(1),
    zIndex: theme.zIndex.appBar,
    backgroundColor: theme.palette.background.paper,
    boxShadow: theme.shadows[3],
    '&:hover': {
      backgroundColor: theme.palette.background.paper,
    },
  },
  desktopDrawer: {
    width: miniVariant ? `calc(${theme.spacing(8)} + 1px)` : theme.dimensions.drawerWidthDesktop,
    transition: theme.transitions.create('width', {
      easing: theme.transitions.easing.sharp,
      duration: theme.transitions.duration.enteringScreen,
    }),
    '@media print': {
      display: 'none',
    },
  },
  mobileDrawer: {
    width: theme.dimensions.drawerWidthTablet,
    '@media print': {
      display: 'none',
    },
  },
  mobileToolbar: {
    zIndex: 1,
    '@media print': {
      display: 'none',
    },
  },
  content: {
    flexGrow: 1,
    alignItems: 'stretch',
    display: 'flex',
    flexDirection: 'column',
    overflowY: 'auto',
  },
}));

const PageTitle = ({ breadcrumbs }) => {
  const theme = useTheme();
  const t = useTranslation();

  const desktop = useMediaQuery(theme.breakpoints.up('md'));

  if (desktop) {
    return (
      <Typography variant="h6" noWrap>
        {t(breadcrumbs[0])}
      </Typography>
    );
  }
  return (
    <Breadcrumbs>
      {breadcrumbs.slice(0, -1).map((breadcrumb) => (
        <Typography variant="h6" color="inherit" key={breadcrumb}>
          {t(breadcrumb)}
        </Typography>
      ))}
      <Typography variant="h6" color="textPrimary">
        {t(breadcrumbs[breadcrumbs.length - 1])}
      </Typography>
    </Breadcrumbs>
  );
};

const PageLayout = ({ menu, breadcrumbs, children }) => {
  const [miniVariant, setMiniVariant] = useState(false);
  const { classes } = useStyles({ miniVariant });
  const theme = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const visibleReports = useVisibleReports();

  const desktop = useMediaQuery(theme.breakpoints.up('md'));

  const [searchParams] = useSearchParams();

  const [openDrawer, setOpenDrawer] = useState(!desktop && searchParams.has('menu'));

  const toggleDrawer = () => setMiniVariant(!miniVariant);

  // On a reports page with at most one report type active there is nothing to
  // choose from, so hide the sidebar entirely and surface a slim top bar that
  // keeps the back arrow (to the main map/devices page) and the page title.
  const hideMenu = location.pathname.startsWith('/reports') && visibleReports.length <= 1;

  if (hideMenu) {
    return (
      <div className={classes.menuHiddenRoot}>
        <IconButton
          className={classes.floatingBack}
          color="inherit"
          onClick={() => navigate('/')}
        >
          <BackIcon />
        </IconButton>
        <div className={classes.content}>{children}</div>
      </div>
    );
  }

  return (
    <div className={classes.root}>
      {desktop ? (
        <Drawer
          variant="permanent"
          className={classes.desktopDrawer}
          classes={{ paper: classes.desktopDrawer }}
        >
          <Toolbar>
            {!miniVariant && (
              <>
                <IconButton
                  color="inherit"
                  edge="start"
                  sx={{ mr: 2 }}
                  onClick={() => navigate('/')}
                >
                  <BackIcon />
                </IconButton>
                <PageTitle breadcrumbs={breadcrumbs} />
              </>
            )}
            <IconButton
              color="inherit"
              edge="start"
              sx={{ ml: miniVariant ? -2 : 'auto' }}
              onClick={toggleDrawer}
            >
              {miniVariant !== (theme.direction === 'rtl') ? (
                <ChevronRightIcon />
              ) : (
                <ChevronLeftIcon />
              )}
            </IconButton>
          </Toolbar>
          <Divider />
          {menu}
        </Drawer>
      ) : (
        <Drawer
          variant="temporary"
          open={openDrawer}
          onClose={() => setOpenDrawer(false)}
          classes={{ paper: classes.mobileDrawer }}
        >
          {menu}
        </Drawer>
      )}
      {!desktop && (
        <AppBar className={classes.mobileToolbar} position="static" color="inherit">
          <Toolbar>
            <IconButton
              color="inherit"
              edge="start"
              sx={{ mr: 2 }}
              onClick={() => setOpenDrawer(true)}
            >
              <MenuIcon />
            </IconButton>
            <PageTitle breadcrumbs={breadcrumbs} />
          </Toolbar>
        </AppBar>
      )}
      <div className={classes.content}>{children}</div>
    </div>
  );
};

export default PageLayout;
