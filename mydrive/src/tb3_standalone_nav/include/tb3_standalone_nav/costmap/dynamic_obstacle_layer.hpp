#ifndef TB3_STANDALONE_NAV__COSTMAP__DYNAMIC_OBSTACLE_LAYER_HPP_
#define TB3_STANDALONE_NAV__COSTMAP__DYNAMIC_OBSTACLE_LAYER_HPP_

#include <vector>
#include "tb3_standalone_nav/visibility_control.h"
#include "tb3_standalone_nav/costmap/costmap_2d.hpp"

namespace tb3_standalone_nav
{
namespace costmap
{

struct DynamicObstacle {
  double x, y;
  double vx, vy;
};

/**
 * @class DynamicObstacleLayer
 * @brief Predicts moving obstacles trajectory utilizing CV Kalman Filter concept and projects them
 * on the costmap to achieve proactive evasion.
 */
class DynamicObstacleLayer
{
public:
  TB3_STANDALONE_NAV_PUBLIC
  DynamicObstacleLayer();

  TB3_STANDALONE_NAV_PUBLIC
  ~DynamicObstacleLayer() = default;

  /**
   * @brief Updates the master grid with predicted obstacle trajectories.
   */
  TB3_STANDALONE_NAV_PUBLIC
  void updateCosts(Costmap2D& master_grid, const std::vector<DynamicObstacle>& obstacles, double prediction_time, double dt);
};

}  // namespace costmap
}  // namespace tb3_standalone_nav

#endif  // TB3_STANDALONE_NAV__COSTMAP__DYNAMIC_OBSTACLE_LAYER_HPP_
